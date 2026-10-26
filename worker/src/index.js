// iframe 삽입을 막는 헤더를 지우고 페이지를 대신 가져다 주는 Cloudflare Worker.
// 정적인 블로그·문서 사이트용이다. 주소 형식: https://<워커 주소>/p/<접근 키>/https://example.com/page
// 페이지 안의 링크·이미지·CSS 주소도 같은 형식으로 바꿔서, 클릭해도 프록시를 벗어나지 않게 한다.
// 바꾸지 못한 주소(JS가 만든 주소 등)는 워커가 붙이는 CSP 때문에 브라우저가 직접 접속하지 못한다.
// 접근 키(ACCESS_KEY, wrangler secret)를 아는 사람만 쓸 수 있다. 키가 설정되지 않았으면 아무 요청도 받지 않는다.

const PREFIX = '/p/';

// 주소에 넣기 때문에 URL에 그대로 쓸 수 있는 문자만 허용한다
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

// iframe 삽입을 막거나, 다른 도메인(워커)에서 의미가 없어지는 응답 헤더
const STRIP_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'strict-transport-security',
  'set-cookie',
];

// 페이지가 워커 밖으로 직접 접속하지 못하게 한다('self' = 워커 주소).
// 원래 사이트의 CSP는 지우고 이것으로 바꾼다. frame-ancestors는 넣지 않아 iframe 삽입은 허용된다
const CSP = [
  "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'",
  "form-action 'self'",
].join('; ');

// 주소를 담는 HTML 속성
const URL_ATTRS = [
  ['a', 'href'],
  ['area', 'href'],
  ['link', 'href'],
  ['img', 'src'],
  ['script', 'src'],
  ['iframe', 'src'],
  ['source', 'src'],
  ['video', 'src'],
  ['video', 'poster'],
  ['audio', 'src'],
  ['track', 'src'],
  ['embed', 'src'],
  ['form', 'action'],
];

export default {
  async fetch(request, env) {
    const self = new URL(request.url);

    if (!env.ACCESS_KEY) {
      return text('ACCESS_KEY가 설정되지 않았습니다: npx wrangler secret put ACCESS_KEY', 503);
    }
    if (!KEY_PATTERN.test(env.ACCESS_KEY)) {
      return text('ACCESS_KEY 형식이 올바르지 않습니다. 영문·숫자·_·- 만 써서 16자 이상으로 다시 넣으세요: npx wrangler secret put ACCESS_KEY', 503);
    }

    if (!self.pathname.startsWith(PREFIX)) {
      // 페이지의 JS가 만든 '/api/...' 같은 루트 상대 주소는 워커 쪽으로 온다.
      // Referer로 원래 사이트와 키를 알아내서 /p/ 주소로 보낸다
      const from = parseProxyUrl(request.headers.get('referer') ?? '', self.origin);
      if (from && (await keyMatches(from.key, env.ACCESS_KEY))) {
        try {
          const origin = new URL(from.raw).origin;
          return Response.redirect(`${self.origin}${PREFIX}${from.key}/${origin}${self.pathname}${self.search}`, 302);
        } catch {
          // 원래 사이트를 알 수 없으면 아래 404로
        }
      }
      return text('Not found', 404);
    }

    // pathname은 '//'를 합칠 수 있으므로 원래 주소 문자열에서 잘라낸다
    const parsed = parseProxyUrl(request.url, self.origin);
    if (!parsed || !(await keyMatches(parsed.key, env.ACCESS_KEY))) {
      return text('접근 키가 올바르지 않습니다.', 403);
    }
    const { key, raw } = parsed;
    let target;
    try {
      target = new URL(raw);
    } catch {
      return text('주소가 올바르지 않습니다: ' + raw, 400);
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return text('http/https 주소만 열 수 있습니다.', 400);
    }
    if (target.hostname === self.hostname) {
      return text('워커 자신의 주소는 열 수 없습니다.', 400);
    }

    // 페이지 안의 주소를 바꿀 때 쓰는 정보
    const ctx = { proxyBase: `${self.origin}${PREFIX}${key}/` };

    const upstream = await fetch(target, {
      method: request.method,
      headers: forwardHeaders(request.headers, target),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });

    const headers = new Headers(upstream.headers);
    for (const name of STRIP_HEADERS) headers.delete(name);
    // 주소에 키가 들어 있으므로 다른 사이트로 가는 요청에는 Referer를 보내지 않게 한다
    headers.set('referrer-policy', 'same-origin');
    headers.set('content-security-policy', CSP);

    // 리다이렉트도 프록시 주소로 바꿔야 iframe이 원래 사이트로 빠져나가지 않는다
    const location = headers.get('location');
    if (location) headers.set('location', proxify(location, target, ctx));

    const type = headers.get('content-type') ?? '';

    if (type.includes('text/html')) {
      headers.delete('content-length');
      return rewriteHtml(new Response(upstream.body, { status: upstream.status, headers }), target, ctx);
    }

    if (type.includes('text/css')) {
      headers.delete('content-length');
      const css = rewriteCss(await upstream.text(), target, ctx);
      return new Response(css, { status: upstream.status, headers });
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function rewriteHtml(response, base, ctx) {
  // <base href>가 있으면 상대 주소의 기준이 바뀐다
  let docBase = base;
  const fix = (value) => proxify(value, docBase, ctx);

  let rewriter = new HTMLRewriter()
    // <base target>도 새 창을 열게 하므로 base는 항상 지운다
    .on('base', {
      element(el) {
        const href = el.getAttribute('href');
        if (href !== null) {
          try {
            docBase = new URL(href, base);
          } catch {
            // 잘못된 base는 무시한다
          }
        }
        el.remove();
      },
    })
    // 새 창은 iframe 밖(프록시 밖)이므로 모든 링크·폼을 iframe 안에서 연다
    .on('a[target], area[target], form[target]', { element: (el) => el.removeAttribute('target') })
    // 내용을 바꾸므로 원본 해시와 맞지 않게 된다
    .on('[integrity]', { element: (el) => el.removeAttribute('integrity') })
    // 페이지가 Referer 정책을 느슨하게 바꾸면 키가 다른 사이트로 새어 나간다
    .on('meta[name="referrer" i]', { element: (el) => el.remove() })
    .on('[referrerpolicy]', { element: (el) => el.removeAttribute('referrerpolicy') })
    .on('meta[http-equiv]', {
      element(el) {
        const name = el.getAttribute('http-equiv').toLowerCase();
        if (name === 'content-security-policy') el.remove();
        if (name === 'refresh') {
          const content = el.getAttribute('content') ?? '';
          el.setAttribute('content', content.replace(/(url=)\s*['"]?([^'";]+)/i, (_, p, u) => p + fix(u)));
        }
      },
    })
    .on('[srcset]', {
      element(el) {
        const srcset = el
          .getAttribute('srcset')
          .split(',')
          .map((part) => {
            const [url, ...rest] = part.trim().split(/\s+/);
            return [fix(url), ...rest].join(' ');
          })
          .join(', ');
        el.setAttribute('srcset', srcset);
      },
    })
    .on('[style]', { element: (el) => el.setAttribute('style', rewriteCss(el.getAttribute('style'), docBase, ctx)) })
    .on('style', new StyleRewriter((css) => rewriteCss(css, docBase, ctx)));

  for (const [tag, attr] of URL_ATTRS) {
    rewriter = rewriter.on(`${tag}[${attr}]`, {
      element: (el) => el.setAttribute(attr, fix(el.getAttribute(attr))),
    });
  }

  return rewriter.transform(response);
}

// <style> 안의 CSS는 조각으로 나뉘어 오므로 모았다가 마지막에 한 번에 바꾼다
class StyleRewriter {
  constructor(rewrite) {
    this.rewrite = rewrite;
    this.buffer = '';
  }

  text(chunk) {
    this.buffer += chunk.text;
    if (chunk.lastInTextNode) {
      chunk.replace(this.rewrite(this.buffer), { html: true });
      this.buffer = '';
    } else {
      chunk.remove();
    }
  }
}

function rewriteCss(css, base, ctx) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, q, url) => `url(${q}${proxify(url, base, ctx)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (_, q, url) => `@import ${q}${proxify(url, base, ctx)}${q}`);
}

// 페이지 안의 주소 → 워커를 거치는 주소. 바꾸면 안 되는 주소(#, data: 등)는 그대로 둔다
function proxify(value, base, { proxyBase }) {
  const trimmed = value.trim();
  if (!trimmed || /^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(trimmed)) return value;
  if (trimmed.startsWith(proxyBase)) return value;

  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
    return proxyBase + url.href;
  } catch {
    return value;
  }
}

// '<워커>/p/<키>/<원래 주소>' → { key, raw }. 형식이 다르면 null
function parseProxyUrl(url, proxyOrigin) {
  const head = proxyOrigin + PREFIX;
  if (!url.startsWith(head)) return null;
  const rest = url.slice(head.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  return { key: rest.slice(0, slash), raw: rest.slice(slash + 1) };
}

// 응답 시간으로 키를 한 글자씩 알아내지 못하도록 해시를 만든 뒤 일정한 시간에 비교한다
async function keyMatches(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all(
    [given, expected].map((v) => crypto.subtle.digest('SHA-256', enc.encode(v))),
  );
  return crypto.subtle.timingSafeEqual(a, b);
}

function forwardHeaders(incoming, target) {
  const headers = new Headers();
  for (const name of ['accept', 'accept-language', 'content-type', 'range', 'user-agent', 'if-none-match', 'if-modified-since']) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  // 원래 사이트 안에서 이동한 것처럼 보이게 한다(Referer 검사하는 사이트 대응)
  headers.set('referer', target.origin + '/');
  return headers;
}

function text(body, status) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
