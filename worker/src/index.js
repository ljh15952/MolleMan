// iframe 삽입을 막는 헤더를 지우고 페이지를 대신 가져다 주는 Cloudflare Worker.
// 정적인 블로그·문서 사이트용이다. 주소 형식: https://<워커 주소>/p/https://example.com/page
// 페이지 안의 링크·이미지·CSS 주소도 /p/ 형식으로 바꿔서, 클릭해도 프록시를 벗어나지 않게 한다.

const PREFIX = '/p/';

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

    if (!self.pathname.startsWith(PREFIX)) {
      // 페이지의 JS가 만든 '/api/...' 같은 루트 상대 주소는 워커 쪽으로 온다.
      // Referer로 원래 사이트를 알아내서 /p/ 주소로 보낸다
      const origin = targetFromReferer(request, self);
      if (origin) {
        return Response.redirect(`${self.origin}${PREFIX}${origin}${self.pathname}${self.search}`, 302);
      }
      return text('사용법: /p/https://example.com', 400);
    }

    // pathname은 '//'를 합칠 수 있으므로 원래 주소 문자열에서 잘라낸다
    const raw = request.url.slice(self.origin.length + PREFIX.length);
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
    if (!isAllowed(target.hostname, env.ALLOWED_HOSTS)) {
      // 허용 목록 밖의 사이트는 프록시 없이 원래 주소로 보낸다.
      // 블로그가 쓰는 CDN의 이미지·CSS는 그대로 받아지고, 페이지는 프록시가 없을 때와 똑같이 열린다
      return Response.redirect(target.href, 302);
    }

    // 페이지 안의 주소를 바꿀 때 쓰는 정보
    const ctx = { proxyOrigin: self.origin, allowed: env.ALLOWED_HOSTS };

    const upstream = await fetch(target, {
      method: request.method,
      headers: forwardHeaders(request.headers, target),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });

    const headers = new Headers(upstream.headers);
    for (const name of STRIP_HEADERS) headers.delete(name);

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
    .on('base[href]', {
      element(el) {
        try {
          docBase = new URL(el.getAttribute('href'), base);
        } catch {
          // 잘못된 base는 무시한다
        }
        el.remove();
      },
    })
    // 내용을 바꾸므로 원본 해시와 맞지 않게 된다
    .on('[integrity]', { element: (el) => el.removeAttribute('integrity') })
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
      element(el) {
        el.setAttribute(attr, fix(el.getAttribute(attr)));
        // 새 창으로 열면 iframe 밖이므로 프록시 없이 원래 주소로 여는 편이 낫다
        if (tag === 'a' && el.getAttribute('target') === '_blank') {
          el.setAttribute(attr, unproxify(el.getAttribute(attr), ctx.proxyOrigin));
        }
      },
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

// 페이지 안의 주소 → 워커를 거치는 주소. 바꾸면 안 되는 주소와 허용 목록 밖 사이트(CDN 등)는 그대로 둔다
function proxify(value, base, { proxyOrigin, allowed }) {
  const trimmed = value.trim();
  if (!trimmed || /^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(trimmed)) return value;
  if (trimmed.startsWith(proxyOrigin + PREFIX)) return value;

  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
    if (!isAllowed(url.hostname, allowed)) return url.href;
    return proxyOrigin + PREFIX + url.href;
  } catch {
    return value;
  }
}

function unproxify(value, proxyOrigin) {
  const head = proxyOrigin + PREFIX;
  return value.startsWith(head) ? value.slice(head.length) : value;
}

function targetFromReferer(request, self) {
  const referer = request.headers.get('referer');
  if (!referer?.startsWith(self.origin + PREFIX)) return null;
  try {
    return new URL(referer.slice(self.origin.length + PREFIX.length)).origin;
  } catch {
    return null;
  }
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

// ALLOWED_HOSTS가 비어 있으면 모든 사이트를 허용한다.
// 'example.com'은 example.com과 그 하위 도메인(www.example.com 등)을 모두 허용한다
function isAllowed(hostname, list) {
  const hosts = (list ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0) return true;
  const host = hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith('.' + h));
}

function text(body, status) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
