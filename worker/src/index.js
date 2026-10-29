// iframe 삽입을 막는 헤더를 지우고 페이지를 대신 가져다 주는 Cloudflare Worker.
// 주소 형식: https://<워커 주소>/p/<접근 키>/https://example.com/page
// 페이지 안의 링크·이미지·CSS 주소도 같은 형식으로 바꿔서, 클릭해도 프록시를 벗어나지 않게 한다.
// 바꾸지 못한 주소(JS가 만든 주소 등)는 워커가 붙이는 CSP 때문에 브라우저가 직접 접속하지 못한다.
// 접근 키(ACCESS_KEY, wrangler secret)를 아는 사람만 쓸 수 있다. 키가 설정되지 않았으면 아무 요청도 받지 않는다.

const PREFIX = '/p/';

// 페이지에 넣는 스크립트(clientPatch)의 주소. 키가 들어 있지 않으므로 키 없이 받을 수 있다
const CLIENT_PATH = '/__mm2/client.js';

// 페이지를 불러온 뒤 가로로 스크롤할 거리(px). 0이면 하지 않는다
const INITIAL_SCROLL_X = 170;

// 쿠키를 주고받는 사이트(도메인). 서브도메인끼리(gall.·search. 등) 같은 쿠키를 쓴다.
// 그 밖의 사이트는 쿠키를 버린다. 모든 사이트가 같은 워커 주소를 쓰므로, 다 받으면 브라우저의 쿠키 한도를 넘는다.
// dcinside는 쿠키(ci_c 등)가 없으면 댓글·검색 요청을 거부한다
const COOKIE_SITES = ['dcinside.com'];

// 주소에 넣기 때문에 URL에 그대로 쓸 수 있는 문자만 허용한다
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,}$/;

// 원래 사이트의 응답에서 버리는 헤더
const STRIP_HEADERS = [
  // iframe 삽입을 막는 것
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  // 다른 도메인(워커)에서 의미가 없어지거나, 모든 사이트가 같은 워커 주소를 쓰므로 다른 사이트까지 망가뜨리는 것.
  // set-cookie는 COOKIE_SITES의 것만 이름을 바꿔 다시 붙인다
  'strict-transport-security',
  'set-cookie',
  'clear-site-data',
  'service-worker-allowed',
  'alt-svc',
  // 브라우저가 CSP를 거치지 않고 다른 사이트에 직접 접속하게 하는 것(오류 보고, preconnect 등).
  // 오류 보고에는 키가 든 페이지 주소가 담긴다. preload의 '/shared_dict/...' 같은 루트 상대 주소도 워커 쪽으로 가서 404가 난다
  'link',
  'nel',
  'report-to',
  'reporting-endpoints',
];

// 본문이 없어야 하는 응답 상태
const NULL_BODY_STATUS = [101, 204, 205, 304];

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
  ['object', 'data'],
  ['form', 'action'],
  ['button', 'formaction'],
  ['input', 'formaction'],
];

// 스크립트를 넣는 응답의 종류. fetch로 받는 HTML 조각에 넣으면 페이지가 그것을 끼워 넣을 때 스크립트가 또 실행된다
const DOCUMENT_DESTS = ['document', 'iframe', 'frame', 'embed', 'object'];

// wrangler 번들러가 함수 안에 __name(...) 호출을 끼워 넣으므로 브라우저 쪽에 같은 이름을 만들어 둔다.
// rewriteSrcset과 쿠키 함수들은 워커와 브라우저가 함께 쓴다
const CLIENT_JS = `(() => { const __name = (f) => f; const rewriteSrcset = ${rewriteSrcset}; const cookieSite = ${cookieSite}; const siteCookies = ${siteCookies}; const rewriteSetCookie = ${rewriteSetCookie}; (${clientPatch})(${INITIAL_SCROLL_X}, ${JSON.stringify(COOKIE_SITES)}); })();`;
// 스크립트가 바뀌면 주소도 바뀌게 해서 브라우저에 남은 예전 스크립트를 쓰지 않게 한다
const CLIENT_VERSION = [...CLIENT_JS].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);

export default {
  async fetch(request, env) {
    const self = new URL(request.url);

    if (!env.ACCESS_KEY) {
      return text('ACCESS_KEY가 설정되지 않았습니다: npx wrangler secret put ACCESS_KEY', 503);
    }
    if (!KEY_PATTERN.test(env.ACCESS_KEY)) {
      return text('ACCESS_KEY 형식이 올바르지 않습니다. 영문·숫자·_·- 만 써서 16자 이상으로 다시 넣으세요: npx wrangler secret put ACCESS_KEY', 503);
    }

    if (self.pathname === CLIENT_PATH) {
      return new Response(CLIENT_JS, {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'public, max-age=31536000, immutable',
          'content-security-policy': CSP,
        },
      });
    }

    if (!self.pathname.startsWith(PREFIX)) {
      // 페이지의 JS가 만든 '/api/...' 같은 루트 상대 주소는 워커 쪽으로 온다.
      // Referer로 원래 사이트와 키를 알아내서 /p/ 주소로 보낸다(307은 POST를 POST 그대로 다시 보내게 한다)
      const from = parseProxyUrl(request.headers.get('referer') ?? '', self.origin);
      if (from && (await keyMatches(from.key, env.ACCESS_KEY))) {
        try {
          const origin = new URL(from.raw).origin;
          return Response.redirect(`${self.origin}${PREFIX}${from.key}/${origin}${self.pathname}${self.search}`, 307);
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
    const { key } = parsed;

    // 페이지 안의 주소를 바꿀 때 쓰는 정보
    const ctx = { proxyBase: `${self.origin}${PREFIX}${key}/` };
    const scrub = keyScrubber(ctx.proxyBase, key);

    let target;
    try {
      target = new URL(scrub(parsed.raw));
    } catch {
      return text('주소가 올바르지 않습니다: ' + parsed.raw, 400);
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return text('http/https 주소만 열 수 있습니다.', 400);
    }
    if (target.hostname === self.hostname) {
      return text('워커 자신의 주소는 열 수 없습니다.', 400);
    }

    // 쿠키를 주고받는 사이트면 그 도메인(예: 'dcinside.com'), 아니면 null
    const site = cookieSite(target.hostname, COOKIE_SITES);

    let upstream;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers: forwardHeaders(request.headers, target, self.origin, site),
        body: await forwardBody(request, scrub),
        redirect: 'manual',
      });
    } catch (e) {
      return text(`사이트에 연결하지 못했습니다: ${target.origin}\n${e}`, 502);
    }

    const headers = new Headers(upstream.headers);
    for (const name of STRIP_HEADERS) headers.delete(name);
    if (site) {
      for (const cookie of upstream.headers.getSetCookie()) {
        headers.append('set-cookie', rewriteSetCookie(cookie, site, `${PREFIX}${key}/`));
      }
    }
    // 주소에 키가 들어 있으므로 다른 사이트로 가는 요청에는 Referer를 보내지 않게 한다
    headers.set('referrer-policy', 'same-origin');
    headers.set('content-security-policy', CSP);

    // 리다이렉트도 프록시 주소로 바꿔야 iframe이 원래 사이트로 빠져나가지 않는다
    const location = headers.get('location');
    if (location) headers.set('location', proxify(location, target, ctx));
    const refresh = headers.get('refresh');
    if (refresh) headers.set('refresh', rewriteRefresh(refresh, (u) => proxify(u, target, ctx)));

    if (request.method === 'HEAD' || NULL_BODY_STATUS.includes(upstream.status)) {
      return new Response(null, { status: upstream.status, headers });
    }

    const type = headers.get('content-type') ?? '';

    if (type.includes('text/html')) {
      headers.delete('content-length');
      // 같은 주소라도 페이지로 열면 스크립트를 넣고 fetch로 받으면 넣지 않으므로, 브라우저 캐시에 따로 저장하게 한다.
      // 그러지 않으면 fetch로 받아 둔 것을 iframe이 꺼내 써서 clientPatch 없이 열린다
      headers.append('vary', 'sec-fetch-dest');
      const dest = request.headers.get('sec-fetch-dest');
      const inject = !dest || DOCUMENT_DESTS.includes(dest);
      if (!inject) {
        // dcinside 댓글처럼 JSON을 text/html로 보내는 API가 있다. HTML로 보고 고치면 JSON 글 안의 src="..."가 바뀌어
        // 따옴표가 깨지고 JSON을 읽지 못한다(댓글에 디시콘·이미지가 있으면 댓글 전체가 안 나온다). 그런 응답은 그대로 넘긴다.
        // fetch로 받은 HTML 조각은 페이지에 넣을 때 clientPatch가 주소를 고친다
        const bytes = new Uint8Array(await upstream.arrayBuffer());
        const body = looksLikeJson(bytes) ? bytes : rewriteHtml(new Response(bytes), target, ctx, false).body;
        return new Response(body, { status: upstream.status, headers });
      }
      // 페이지에는 clientPatch의 버전이 든 주소가 들어간다. 원래 사이트의 캐시 설정대로 브라우저가 페이지를 저장하면
      // 워커를 다시 배포해도 예전 clientPatch를 계속 쓰므로, 매번 새로 받게 한다(조건부 요청도 원래 사이트의 304가 오므로 막는다)
      headers.set('cache-control', 'no-cache');
      headers.delete('etag');
      headers.delete('last-modified');
      headers.delete('expires');
      return rewriteHtml(new Response(upstream.body, { status: upstream.status, headers }), target, ctx, inject);
    }

    if (type.includes('text/css')) {
      headers.delete('content-length');
      const css = mapBytesAsText(await upstream.arrayBuffer(), (s) => rewriteCss(s, target, ctx));
      return new Response(css, { status: upstream.status, headers });
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function rewriteHtml(response, base, ctx, inject) {
  // <base href>가 있으면 상대 주소의 기준이 바뀐다
  let docBase = base;
  const fix = (value) => proxify(value, docBase, ctx);

  let injected = !inject;

  let rewriter = new HTMLRewriter()
    // 페이지의 JS보다 먼저 실행되도록 <head> 맨 앞에 넣는다.
    // <head>가 없는 페이지(예: '<script>location.replace(...)</script>' 한 줄뿐인 응답)는 맨 처음 나오는 요소 앞에 넣는다
    .on('*', {
      element(el) {
        if (injected || el.tagName === 'html') return;
        injected = true;
        const script = `<script src="${CLIENT_PATH}?v=${CLIENT_VERSION}"></script>`;
        if (el.tagName === 'head') el.prepend(script, { html: true });
        else el.before(script, { html: true });
      },
    })
    // base를 지우면 'No base href'로 멈추는 SPA가 있으므로 주소만 바꾼다. target은 새 창을 열게 하므로 지운다
    .on('base', {
      element(el) {
        const href = el.getAttribute('href');
        if (href !== null) {
          try {
            docBase = new URL(href, base);
          } catch {
            // 잘못된 base는 무시한다
          }
          el.setAttribute('href', proxify(href, base, ctx));
        }
        el.removeAttribute('target');
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
        if (name === 'refresh') el.setAttribute('content', rewriteRefresh(el.getAttribute('content') ?? '', fix));
      },
    })
    .on('[srcset]', { element: (el) => el.setAttribute('srcset', rewriteSrcset(el.getAttribute('srcset'), fix)) })
    .on('[style]', { element: (el) => el.setAttribute('style', rewriteCss(el.getAttribute('style'), docBase, ctx)) })
    .on('style', new TextRewriter((css) => rewriteCss(css, docBase, ctx)))
    // import map(JSON) 안의 모듈 주소. GitHub 등이 React 같은 스크립트를 이것으로 불러온다
    .on('script[type="importmap" i]', new TextRewriter((json) => rewriteImportMap(json, docBase, ctx)));

  for (const [tag, attr] of URL_ATTRS) {
    rewriter = rewriter.on(`${tag}[${attr}]`, {
      element: (el) => el.setAttribute(attr, fix(el.getAttribute(attr))),
    });
  }

  return rewriter.transform(response);
}

// 브라우저 안에서 실행되는 코드(문자열로 바꿔 CLIENT_PATH로 내보낸다). 바깥 변수는 rewriteSrcset만 쓸 수 있다.
// HTML 속의 주소는 워커가 바꾸지만 JS가 실행 중에 만든 주소(이동·iframe·이미지·fetch)는 못 바꾸므로,
// 여기서 가로채 워커 주소로 바꾼다. 놓친 주소는 워커의 CSP가 막는다
function clientPatch(initialScrollX, cookieSites) {
  // 같은 창에서 두 번 실행되면 단축키 등이 겹치므로 한 번만 한다
  if (window.__mm2) return;
  window.__mm2 = true;

  // srcdoc iframe에 이 스크립트를 넣을 때 쓴다
  const clientSrc = document.currentScript?.src;
  // '<워커>/p/<키>/'. 이 스크립트에는 키가 들어 있지 않으므로 페이지 주소에서 알아낸다.
  // srcdoc iframe(about:srcdoc)은 자기 주소가 없으므로, 넣은 페이지에게서 물려받는 기준 주소를 쓴다
  const pageUrl = /^https?:/.test(location.href) ? location.href : document.baseURI;
  const proxyBase = /^https?:\/\/[^/]+\/p\/[^/]+\//.exec(pageUrl)?.[0];
  if (!proxyBase) return;

  // 페이지를 다 불러오면 가로로 조금 스크롤한다(이전 WinForms 버전과 같은 동작).
  // 페이지 안에 들어 있는 iframe(광고 등)은 빼고, 앱 화면에 직접 뜬 페이지에서만 한다
  const isPageFrame = (() => {
    try {
      return parent === window || parent.location.origin !== location.origin;
    } catch {
      return true;
    }
  })();
  // 앱 화면(다른 사이트). 단축키 메시지를 받을 때 쓴다
  const appParent = parent;
  // dcinside 등은 자기 사이트의 iframe 안에 들어가는 것을 전제로 parent.location·parent.document를 읽는다.
  // 앱 화면 안에서는 다른 사이트라서 보안 오류로 스크립트가 통째로 멈추므로(메인 검색이 정의되지 않는 등),
  // 페이지에는 parent가 자기 자신(최상위 창)으로 보이게 한다.
  // 다만 top은 바꿀 수 없으므로, 광고·분석 스크립트가 흔히 쓰는 'while (w !== top) w = w.parent' 같은 반복은 끝나지 않아
  // 페이지가 '응답하지 않음'으로 멈춘다. 한 번에(작업이 쉬지 않고) 너무 많이 읽으면 그런 반복으로 보고 진짜 parent를 돌려준다
  if (isPageFrame && appParent !== window) {
    const PARENT_LOOP_LIMIT = 1000;
    let parentReads = 0;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get() {
        if (parentReads === 0) queueMicrotask(() => { parentReads = 0; });
        return ++parentReads > PARENT_LOOP_LIMIT ? appParent : window;
      },
    });
  }
  if (isPageFrame && initialScrollX) {
    addEventListener('load', () => {
      // 페이지가 화면보다 넓지 않으면 스크롤할 공간이 없으므로, 오른쪽 끝 너머에 보이지 않는 점을 두어 공간을 만든다.
      // absolute 요소는 배치에 영향을 주지 않고 스크롤 범위만 넓힌다
      const root = document.documentElement;
      const spacer = document.createElement('div');
      spacer.style.cssText = 'position:absolute;top:0;width:1px;height:1px;pointer-events:none;visibility:hidden';
      spacer.style.left = Math.max(root.scrollWidth, root.clientWidth + initialScrollX) - 1 + 'px';
      // body가 position을 가지면 그 기준으로 위치가 잡히므로 <html>에 직접 붙인다
      root.appendChild(spacer);
      scrollTo(initialScrollX, scrollY);
    });
  }

  // 이 페이지의 원래 사이트(예: https://www.youtube.com). '/results' 같은 루트 상대 주소를 바꿀 때 쓴다
  const siteOrigin = (() => {
    try {
      return new URL(pageUrl.slice(proxyBase.length)).origin;
    } catch {
      return null;
    }
  })();

  const px = (value) => {
    // 이미 바꾼 주소(워커가 HTML에서 바꾼 것 대부분)는 URL을 해석하지 않고 바로 돌려준다
    if (typeof value === 'string' && value.startsWith(proxyBase)) return value;
    try {
      const url = new URL(String(value), document.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return value;
      if (url.origin === location.origin) {
        // 워커 주소지만 /p/<키>/ 가 빠진 주소(루트 상대 주소)는 원래 사이트의 주소로 본다.
        // /cdn-cgi/ 는 Cloudflare가 워커 도메인에 넣는 스크립트(Web Analytics 등)가 보내는 것이라 원래 사이트로 보내면 404가 난다
        if (url.href.startsWith(proxyBase) || url.pathname.startsWith('/__mm2/') || url.pathname.startsWith('/cdn-cgi/') || !siteOrigin) return value;
        return proxyBase + siteOrigin + url.pathname + url.search + url.hash;
      }
      return proxyBase + url.href;
    } catch {
      return value;
    }
  };

  // CSS 글 안의 url(...)
  const cssPx = (text) => String(text).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, q, url) => `url(${q}${px(url)}${q})`);

  // SPA가 주소를 '/results' 처럼 바꾸면 /p/<키>/ 가 빠져 이후의 상대 주소 요청이 모두 어긋나므로 막는다
  const replaceState = History.prototype.replaceState;
  for (const name of ['pushState', 'replaceState']) {
    const original = History.prototype[name];
    History.prototype[name] = function (state, title, url) {
      return original.call(this, state, title, url == null ? url : px(url));
    };
  }

  // ===== 다른 사이트와 함께 쓰는 것 막기 =====
  // 모든 사이트가 같은 워커 주소를 쓰므로, JS가 만든 쿠키가 사이트마다 쌓이면 요청 헤더가 커져 결국 모든 요청이 실패한다.
  // COOKIE_SITES의 쿠키는 워커와 같은 방식(이름 앞에 '<도메인>~')으로 브라우저에 저장하고, 이 사이트의 것만 보이게 한다.
  // 그 밖의 사이트의 쿠키는 이 페이지가 열려 있는 동안만 메모리에 둔다(서버가 주는 쿠키는 워커가 버린다)
  const site = siteOrigin && cookieSite(new URL(siteOrigin).hostname, cookieSites);
  const nativeCookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  const jar = new Map();
  Object.defineProperty(document, 'cookie', site ? {
    configurable: true,
    get: () => siteCookies(nativeCookie.get.call(document), site),
    set: (text) => nativeCookie.set.call(document, rewriteSetCookie(text, site, new URL(proxyBase).pathname)),
  } : {
    configurable: true,
    get: () => [...jar].map(([name, value]) => (name ? `${name}=${value}` : value)).join('; '),
    set(text) {
      const [pair, ...attrs] = String(text).split(';');
      const eq = pair.indexOf('=');
      const name = eq < 0 ? '' : pair.slice(0, eq).trim();
      const value = eq < 0 ? pair.trim() : pair.slice(eq + 1).trim();
      const expired = attrs.some((attr) => {
        const [k, ...v] = attr.split('=');
        const key = k.trim().toLowerCase();
        if (key === 'max-age') return Number(v.join('=')) <= 0;
        if (key === 'expires') return Date.parse(v.join('=')) <= Date.now();
        return false;
      });
      if (expired) jar.delete(name);
      else jar.set(name, value);
    },
  });
  // ===== 원래 사이트의 주소를 기대하는 스크립트 =====
  // 페이지 주소의 호스트는 워커이므로, 원래 도메인을 전제로 한 코드가 오류로 멈추면 그 뒤의 기능(검색 등)이 모두 동작하지 않는다
  const siteHost = siteOrigin && new URL(siteOrigin).hostname;
  // document.domain = 'dcinside.com' 은 워커 주소에서 SecurityError가 난다. 원래 도메인이면 넣은 것으로 치고 그 값을 돌려준다
  const nativeDomain = Object.getOwnPropertyDescriptor(Document.prototype, 'domain');
  let domain = siteHost;
  Object.defineProperty(document, 'domain', {
    configurable: true,
    get: () => domain ?? nativeDomain.get.call(document),
    set(value) {
      const v = String(value).toLowerCase();
      if (siteHost && (siteHost === v || siteHost.endsWith('.' + v))) domain = v;
      else nativeDomain.set.call(document, value);
    },
  });
  // dcinside의 crossDomainStorage는 저장소 iframe의 주소를 location.host와 비교해, 같은 사이트면 iframe 없이 localStorage를 쓴다.
  // 워커 주소에서는 다른 사이트로 보여 <head> 안에서 document.body에 iframe을 넣으려다 멈추므로, 같은 사이트의 주소면 워커 주소로 바꿔 넘긴다
  let crossDomainStorage;
  Object.defineProperty(window, 'crossDomainStorage', {
    configurable: true,
    get: () => crossDomainStorage,
    set(fn) {
      crossDomainStorage = typeof fn !== 'function' ? fn : function (opts) {
        try {
          if (opts?.origin && new URL(opts.origin, siteOrigin).hostname === siteHost) opts = { ...opts, origin: location.origin };
        } catch {
          // 주소가 아니면 그대로 넘긴다
        }
        return fn.call(this, opts);
      };
    },
  });

  // 서비스 워커는 워커 주소 전체를 가로챌 수 있다. WebRTC는 CSP를 거치지 않고 실제 IP로 직접 통신한다
  if (window.ServiceWorkerContainer) {
    ServiceWorkerContainer.prototype.register = () => Promise.reject(new DOMException('프록시에서는 쓸 수 없습니다', 'SecurityError'));
  }
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) delete window[name];

  // ===== 단축키(이전 WinForms 버전과 같음) =====
  // Q: 마우스 커서 위치 클릭, W: 뒤로, A: 위로 스크롤(휠 2칸), S: 아래로 스크롤(휠 5칸).
  // 페이지 안을 클릭해 포커스가 여기 있을 때는 keydown으로, 앱 툴바에 포커스가 있을 때는 앱이 보내는 메시지로 받는다
  const WHEEL_STEP = 100;
  let mouseX = -1;
  let mouseY = -1;
  addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, true);

  // 휠처럼 커서 아래에서 스크롤할 수 있는 요소를 찾는다. 없으면 페이지 전체
  const scrollTarget = () => {
    for (let el = document.elementFromPoint(mouseX, mouseY); el && el !== document.body; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    }
    return window;
  };

  const runHotkey = (key) => {
    if (key === 'w') {
      history.back();
    } else if (key === 'a' || key === 's') {
      scrollTarget().scrollBy({ top: key === 'a' ? -2 * WHEEL_STEP : 5 * WHEEL_STEP, behavior: 'instant' });
    } else if (key === 'q') {
      const el = mouseX >= 0 && document.elementFromPoint(mouseX, mouseY);
      if (!el) return;
      const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: mouseX, clientY: mouseY, button: 0 };
      el.dispatchEvent(new PointerEvent('pointerdown', init));
      el.dispatchEvent(new MouseEvent('mousedown', init));
      el.focus?.();
      el.dispatchEvent(new PointerEvent('pointerup', init));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      // click()은 링크 이동·체크박스 등 기본 동작까지 실행한다. SVG 아이콘에는 click()이 없으므로 이벤트를 보낸다
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', init));
    }
  };

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    // 자동 완성이 보내는 keydown에는 key가 없다
    const key = e.key?.toLowerCase();
    if (!['q', 'w', 'a', 's'].includes(key)) return;
    // 웹 컴포넌트 안의 입력란은 e.target이 컴포넌트 자신이므로 실제로 입력 중인 요소를 본다
    const t = e.composedPath()[0];
    if (t?.isContentEditable || /^(input|textarea|select)$/i.test(t?.tagName ?? '')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    runHotkey(key);
  }, true);

  if (isPageFrame) {
    addEventListener('message', (e) => {
      if (e.source === appParent && appParent !== window && typeof e.data?.mm2Hotkey === 'string') runHotkey(e.data.mm2Hotkey);
    });
  }

  // 이동: location.href = 'https://...' , JS가 만든 링크 클릭 등
  if (window.navigation) {
    navigation.addEventListener('navigate', (e) => {
      const dest = e.destination.url;
      if (!e.cancelable || e.formData || e.destination.sameDocument || px(dest) === dest) return;
      e.preventDefault();
      if (e.downloadRequest !== null) {
        // 다운로드 링크는 이동하지 않고 프록시 주소로 내려받는다
        const a = document.createElement('a');
        a.href = px(dest);
        a.download = e.downloadRequest;
        a.click();
      } else if (e.navigationType === 'replace') {
        location.replace(px(dest));
      } else {
        location.assign(px(dest));
      }
    });
    // 위의 pushState 가로채기를 거치지 않고 주소가 바뀌는 경우(다른 창의 History 함수를 빌려 쓰는 사이트 등)에도
    // 바뀐 직후 /p/<키>/ 를 다시 붙인다. history.state는 그대로 둔다
    navigation.addEventListener('currententrychange', () => {
      if (!location.href.startsWith(proxyBase)) replaceState.call(history, history.state, '', px(location.href));
    });
  }

  // ===== 요소의 주소 =====
  // srcdoc의 HTML은 주소를 바꾸고 이 스크립트를 맨 앞(<!DOCTYPE> 뒤)에 넣는다. 그래야 그 안의 JS가 만든 주소도 바뀐다
  const srcdocPx = (html) => {
    const fixed = htmlPx(html);
    return clientSrc ? fixed.replace(/^(\s*<!doctype[^>]*>)?/i, (doctype) => `${doctype}<script src="${clientSrc}"></script>`) : fixed;
  };
  const ATTRS = { src: px, href: px, action: px, formaction: px, poster: px, data: px, srcset: (v) => rewriteSrcset(v, px), style: cssPx, srcdoc: srcdocPx };
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const fix = ATTRS[String(name).toLowerCase()];
    return setAttribute.call(this, name, fix ? fix(value) : value);
  };
  const setAttributeNS = Element.prototype.setAttributeNS;
  Element.prototype.setAttributeNS = function (ns, name, value) {
    // SVG의 xlink:href
    return setAttributeNS.call(this, ns, name, /(^|:)href$/i.test(String(name)) ? px(value) : value);
  };
  for (const [type, prop, fix] of [
    [HTMLImageElement, 'src', px],
    [HTMLImageElement, 'srcset', (v) => rewriteSrcset(v, px)],
    [HTMLSourceElement, 'srcset', (v) => rewriteSrcset(v, px)],
    [HTMLScriptElement, 'src', px],
    [HTMLIFrameElement, 'src', px],
    [HTMLSourceElement, 'src', px],
    [HTMLMediaElement, 'src', px],
    [HTMLVideoElement, 'poster', px],
    [HTMLLinkElement, 'href', px],
    [HTMLAnchorElement, 'href', px],
    [HTMLFormElement, 'action', px],
    [HTMLObjectElement, 'data', px],
    [HTMLIFrameElement, 'srcdoc', srcdocPx],
  ]) {
    const desc = Object.getOwnPropertyDescriptor(type.prototype, prop);
    if (!desc?.set) continue;
    Object.defineProperty(type.prototype, prop, {
      ...desc,
      set(value) {
        desc.set.call(this, fix(value));
      },
    });
  }

  // innerHTML·document.write 등으로 넣는 HTML 글. 요소가 만들어지는 순간 이미지 등을 받기 시작하므로
  // 아래 MutationObserver가 고치기 전에 CSP에 막힌다(카카오 광고 safeframe의 document.write 등). 넣기 전에 글에서 주소를 바꾼다.
  // 태그 안의 속성만 바꾸고, <script> 안의 글('"<img src=" + x + ">"' 같은 JS)은 건드리지 않는다
  const tagPx = (tag) => tag.replace(/(\s)(src|href|action|formaction|poster|srcset)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/gi, (all, sp, name, eq, raw) => {
    const q = raw[0] === '"' || raw[0] === "'" ? raw[0] : '';
    const value = q ? raw.slice(1, -1) : raw;
    // 빈 주소는 페이지 자신의 주소로 바뀌므로 그대로 둔다
    return value.trim() ? sp + name + eq + q + ATTRS[name.toLowerCase()](value) + q : all;
  });
  // <style> 안의 url(...)도 바꾼다(광고가 document.write로 넣는 배경 이미지 등)
  const htmlPx = (html) => String(html).replace(
    /(<script\b[^>]*>)[\s\S]*?(?:<\/script\s*>|$)|(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>|$)|<[a-z][^>]*>/gi,
    (match, scriptTag, styleTag, css, styleEnd) => {
      if (scriptTag) return tagPx(scriptTag) + match.slice(scriptTag.length);
      if (styleTag) return styleTag + cssPx(css) + styleEnd;
      return tagPx(match);
    },
  );
  for (const [type, prop] of [[Element, 'innerHTML'], [Element, 'outerHTML'], [window.ShadowRoot, 'innerHTML']]) {
    const desc = type && Object.getOwnPropertyDescriptor(type.prototype, prop);
    if (!desc?.set) continue;
    Object.defineProperty(type.prototype, prop, {
      ...desc,
      set(value) {
        // <script>·<style>의 innerHTML은 HTML이 아니다
        desc.set.call(this, this.tagName === 'SCRIPT' || this.tagName === 'STYLE' ? value : htmlPx(value));
      },
    });
  }
  const insertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (position, html) {
    return insertAdjacentHTML.call(this, position, htmlPx(html));
  };
  const createContextualFragment = Range.prototype.createContextualFragment;
  Range.prototype.createContextualFragment = function (html) {
    return createContextualFragment.call(this, htmlPx(html));
  };
  for (const name of ['write', 'writeln']) {
    const original = Document.prototype[name];
    Document.prototype[name] = function (...parts) {
      return original.apply(this, parts.map(htmlPx));
    };
  }
  // 광고(카카오 ba.min.js 등)는 빈 iframe(about:blank)을 만들어 contentDocument.write로 광고 HTML을 써 넣는다.
  // 그 iframe은 워커를 거치지 않아 이 스크립트가 없으므로, 페이지가 iframe 안을 꺼내 쓸 때 그 창의 write도 바꿔 둔다.
  // 그 iframe이 나중에 프록시 페이지로 이동하면 그 페이지의 이 스크립트가 다시 실행된다(바꾼 주소는 다시 바꿔도 같다)
  const patchFrame = (win) => {
    try {
      if (!win || win === window || win.__mm2 || win.__mm2Write) return;
      win.__mm2Write = true;
      for (const name of ['write', 'writeln']) {
        const original = win.Document.prototype[name];
        win.Document.prototype[name] = function (...parts) {
          return original.apply(this, parts.map(htmlPx));
        };
      }
    } catch {
      // 다른 사이트의 창은 건드릴 수 없다(어차피 워커 주소가 아니다)
    }
  };
  for (const prop of ['contentWindow', 'contentDocument']) {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, prop);
    if (!desc?.get) continue;
    Object.defineProperty(HTMLIFrameElement.prototype, prop, {
      ...desc,
      get() {
        const value = desc.get.call(this);
        patchFrame(prop === 'contentWindow' ? value : value?.defaultView);
        return value;
      },
    });
  }

  // JS로 넣는 스타일(CSS-in-JS의 insertRule 등). el.style.backgroundImage = ... 처럼 속성으로 넣는 것은
  // Chrome에서 가로챌 수 없으므로 아래 MutationObserver가 style 속성이 바뀐 직후에 고친다
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
    return setProperty.call(this, name, value == null ? value : cssPx(value), priority);
  };
  const insertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function (rule, ...rest) {
    return insertRule.call(this, cssPx(rule), ...rest);
  };
  const replaceSync = CSSStyleSheet.prototype.replaceSync;
  CSSStyleSheet.prototype.replaceSync = function (text) {
    return replaceSync.call(this, cssPx(text));
  };
  const replace = CSSStyleSheet.prototype.replace;
  CSSStyleSheet.prototype.replace = function (text) {
    return replace.call(this, cssPx(text));
  };

  // innerHTML 등으로 한꺼번에 들어온 요소는 들어온 뒤에 고친다.
  // 고친 값은 다시 바꿔도 같으므로(px(px(x)) === px(x)) 고친 뒤 생기는 변화로 무한히 반복되지 않는다
  const fixElement = (el) => {
    for (const name of ['src', 'href', 'action', 'formaction', 'srcset', 'style']) {
      const value = el.getAttribute(name);
      if (value === null || (name === 'style' && !value.includes('url('))) continue;
      const fixed = ATTRS[name](value);
      if (fixed !== value) setAttribute.call(el, name, fixed);
    }
    if (el.tagName === 'STYLE' && el.textContent.includes('url(') && cssPx(el.textContent) !== el.textContent) {
      el.textContent = cssPx(el.textContent);
    }
    if (el.getAttribute('target')) el.removeAttribute('target');
  };
  // 페이지를 읽는 동안에는 요소가 하나씩 들어오므로 기록이 수천 개 쌓인다. 부모를 querySelectorAll로 볼 때 자식도 이미 봤으므로
  // 같은 요소를 다시 보지 않는다(그러지 않으면 깊이만큼 반복되어 페이지가 수백 ms씩 멈추고 클릭도 먹지 않는다)
  const fixStyle = (el) => {
    const value = el.getAttribute('style');
    if (value === null || !value.includes('url(')) return;
    const fixed = cssPx(value);
    if (fixed !== value) setAttribute.call(el, 'style', fixed);
  };
  new MutationObserver((records) => {
    const seen = new Set();
    for (const record of records) {
      if (record.type === 'attributes') {
        // style만 지켜보므로 style만 고친다(애니메이션은 이것을 매 프레임 바꾼다)
        fixStyle(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 || seen.has(node) || !node.isConnected) continue;
        fixElement(node);
        for (const el of node.querySelectorAll('[src],[href],[action],[formaction],[srcset],[style],[target],style')) {
          if (!seen.has(el)) fixElement(el);
        }
        // 이 요소 밑의 요소가 나중 기록에 나와도 위에서 이미 봤다
        for (const el of node.getElementsByTagName('*')) seen.add(el);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

  // ===== 통신 =====
  // Request 객체를 그대로 복사하면 본문이 스트림이 되어 브라우저가 보내지 못하므로, 본문을 먼저 읽어 새로 만든다.
  // 다른 창(iframe)에서 만든 Request는 instanceof로 알 수 없으므로 모양으로 판단한다
  const fetch = window.fetch;
  window.fetch = async (input, init) => {
    if (typeof input !== 'object' || input instanceof URL || !('url' in input && 'method' in input)) return fetch(px(input), init);
    const body = input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.blob();
    const { method, headers, credentials, cache, redirect, signal, keepalive } = input;
    return fetch(px(input.url), { method, headers, body, credentials, cache, redirect, signal, keepalive, ...init });
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return open.call(this, method, px(url), ...rest);
  };
  if (navigator.sendBeacon) {
    const sendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => sendBeacon(px(url), data);
  }
  for (const name of ['EventSource', 'Worker', 'SharedWorker']) {
    if (!window[name]) continue;
    window[name] = new Proxy(window[name], { construct: (Type, [url, ...rest]) => new Type(px(url), ...rest) });
  }

  // ===== 창 사이의 메시지 =====
  // 프록시를 거친 창은 모두 워커 주소이므로, postMessage(msg, 'https://gall.dcinside.com') 처럼 원래 사이트를 지정하면
  // 받는 창의 주소와 맞지 않아 메시지가 버려진다(dcinside의 crossDomainStorage 등). 원래 사이트의 주소는 워커 주소로 바꾼다.
  // 받는 쪽 스크립트가 보낸 창을 호출하므로 이 창의 postMessage를 바꾼다
  const fixTargetOrigin = (origin) => {
    if (typeof origin !== 'string' || origin === '*' || origin === '/') return origin;
    try {
      return new URL(origin).origin === location.origin ? origin : location.origin;
    } catch {
      return origin;
    }
  };
  const postMessage = window.postMessage;
  window.postMessage = function (message, options, ...rest) {
    const fixed = options && typeof options === 'object' ? { ...options, targetOrigin: fixTargetOrigin(options.targetOrigin) } : fixTargetOrigin(options);
    return postMessage.call(this, message, fixed, ...rest);
  };
  // 받는 쪽은 e.origin이 원래 사이트인지 확인하므로(예: /(^|\.)dcinside\.com$/), 워커 주소에서 온 메시지는 보낸 창의 원래 사이트로 보여 준다
  const originDesc = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'origin');
  Object.defineProperty(MessageEvent.prototype, 'origin', {
    ...originDesc,
    get() {
      const origin = originDesc.get.call(this);
      if (origin !== location.origin) return origin;
      try {
        const href = this.source?.location?.href ?? '';
        return href.startsWith(proxyBase) ? new URL(href.slice(proxyBase.length)).origin : siteOrigin ?? origin;
      } catch {
        return siteOrigin ?? origin;
      }
    },
  });
}

// srcset의 각 주소를 바꾼다. 주소 안에 쉼표가 있을 수 있으므로(예: 이미지 CDN의 'w_100,c_fill') 규격대로
// "공백이 아닌 글자들(끝의 쉼표 제외)"을 주소로 보고, 그 뒤 쉼표까지를 크기 설명으로 본다.
// 브라우저 쪽(clientPatch)에서도 쓰므로 바깥 변수를 쓰면 안 된다
function rewriteSrcset(value, fix) {
  const text = String(value);
  const out = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length) break;
    let end = i;
    while (end < text.length && !/\s/.test(text[end])) end++;
    let url = text.slice(i, end);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      i = end;
    } else {
      const comma = text.indexOf(',', end);
      descriptor = text.slice(end, comma < 0 ? text.length : comma).trim();
      i = comma < 0 ? text.length : comma + 1;
    }
    out.push(descriptor ? `${fix(url)} ${descriptor}` : fix(url));
  }
  return out.join(', ');
}

// ===== 쿠키 =====
// 쿠키는 워커 주소에 '<도메인>~<이름>' 으로 저장한다. 사이트로 보낼 때는 그 도메인의 것만 골라 원래 이름으로 되돌린다.
// 아래 세 함수는 브라우저 쪽(clientPatch)에서도 쓰므로 바깥 변수를 쓰면 안 된다

// 'gall.dcinside.com' → 'dcinside.com'. 쿠키를 주고받지 않는 사이트면 null
function cookieSite(hostname, sites) {
  return sites.find((domain) => hostname === domain || hostname.endsWith('.' + domain)) ?? null;
}

// 브라우저가 보낸 Cookie 헤더(또는 document.cookie)에서 그 도메인의 쿠키만 원래 이름으로 꺼낸다
function siteCookies(header, site) {
  const prefix = site + '~';
  return String(header)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(prefix))
    .map((s) => s.slice(prefix.length))
    .join('; ');
}

// 사이트가 준 Set-Cookie(또는 document.cookie에 넣는 글) → 워커 주소에 저장할 Set-Cookie.
// Domain·Path는 워커 주소에서 맞지 않으므로 '/p/<키>/' 아래 전체로 바꾼다(다른 사이트로는 워커가 보내지 않는다).
// 앱 화면(다른 도메인) 속 iframe에서도 저장되도록 SameSite=None·Partitioned로 한다
function rewriteSetCookie(text, site, path) {
  const [pair, ...attrs] = String(text).split(';');
  const eq = pair.indexOf('=');
  const name = eq < 0 ? '' : pair.slice(0, eq).trim();
  const value = eq < 0 ? pair.trim() : pair.slice(eq + 1).trim();
  const kept = attrs.map((a) => a.trim()).filter((a) => /^(expires|max-age|httponly)\b/i.test(a));
  return [`${site}~${name}=${value}`, ...kept, `Path=${path}`, 'Secure', 'SameSite=None', 'Partitioned'].join('; ');
}

// <style>·<script> 안의 글은 조각으로 나뉘어 오므로 모았다가 마지막에 한 번에 바꾼다
class TextRewriter {
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

function rewriteImportMap(json, base, ctx) {
  try {
    const map = JSON.parse(json);
    const fixAll = (entries) =>
      Object.fromEntries(Object.entries(entries ?? {}).map(([name, url]) => [name, proxify(String(url), base, ctx)]));
    if (map.imports) map.imports = fixAll(map.imports);
    if (map.scopes) {
      map.scopes = Object.fromEntries(
        Object.entries(map.scopes).map(([scope, entries]) => [proxify(scope, base, ctx), fixAll(entries)]),
      );
    }
    // </script>가 글 안에 들어가 태그가 끊기지 않게 한다
    return JSON.stringify(map).replace(/</g, '\\u003c');
  } catch {
    return json;
  }
}

function rewriteCss(css, base, ctx) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_, q, url) => `url(${q}${proxify(url, base, ctx)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (_, q, url) => `@import ${q}${proxify(url, base, ctx)}${q}`);
}

// 'Refresh: 5; url=...' (헤더와 <meta http-equiv="refresh">)의 주소
function rewriteRefresh(value, fix) {
  return value.replace(/(url\s*=\s*)(['"]?)([^'";]+)\2/i, (_, head, q, url) => head + q + fix(url.trim()) + q);
}

// 글자 인코딩(UTF-8, EUC-KR 등)을 몰라도 깨지지 않게, 바이트를 한 글자씩 그대로 문자열로 보고 바꾼 뒤 되돌린다.
// 바꾸는 부분(url(...) 등)은 ASCII이므로 이렇게 해도 된다
function mapBytesAsText(buffer, map) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const result = map(text);
  const out = new Uint8Array(result.length);
  for (let i = 0; i < result.length; i++) out[i] = result.charCodeAt(i);
  return out;
}

// 본문이 (BOM·공백 뒤에) { 나 [ 로 시작하면 JSON으로 본다
function looksLikeJson(bytes) {
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return bytes[i] === 0x7b || bytes[i] === 0x5b;
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

// 페이지의 JS는 키가 든 자기 주소(location.href)를 읽을 수 있고, 분석·광고 스크립트는 그것을 수집 서버로 보낸다.
// 그 요청도 워커를 거치므로, 원래 사이트로 보내기 전에 주소·본문에서 '<워커>/p/<키>/'를 지워 원래 주소만 남기고
// 남은 키도 지운다(URL 인코딩된 것 포함)
function keyScrubber(proxyBase, key) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = [proxyBase, encodeURIComponent(proxyBase), encodeURIComponent(encodeURIComponent(proxyBase))];
  const pattern = new RegExp([...variants, key].map(escape).join('|'), 'gi');
  return (text) => text.replace(pattern, '');
}

// 요청 본문. 글 형식(JSON·폼·텍스트)이면 키를 지운다. 큰 본문(파일 올리기 등)은 그대로 넘긴다
async function forwardBody(request, scrub) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const type = request.headers.get('content-type') ?? '';
  const size = Number(request.headers.get('content-length') ?? 0);
  if (!/json|text|x-www-form-urlencoded|javascript|xml/i.test(type) || size > 1_000_000) return request.body;
  return mapBytesAsText(await request.arrayBuffer(), scrub);
}

// 원래 사이트로 넘기지 않는 요청 헤더. 워커 주소·Cloudflare·쿠키에 관한 것이다(쿠키는 그 사이트의 것만 골라 다시 붙인다).
// 그 밖의 헤더(API 키 등 사이트가 JS로 붙인 것 포함)는 그대로 넘겨야 API 요청이 거부되지 않는다
const DROP_REQUEST_HEADERS = ['host', 'cookie', 'origin', 'referer', 'connection', 'accept-encoding', 'cdn-loop', 'x-real-ip', 'content-length'];

function forwardHeaders(incoming, target, proxyOrigin, site) {
  const headers = new Headers();
  for (const [name, value] of incoming) {
    if (DROP_REQUEST_HEADERS.includes(name) || name.startsWith('cf-') || name.startsWith('x-forwarded-')) continue;
    headers.set(name, value);
  }
  if (site) {
    const cookie = siteCookies(incoming.get('cookie') ?? '', site);
    if (cookie) headers.set('cookie', cookie);
  }
  const page = originalPage(incoming.get('referer') ?? '', proxyOrigin);
  // 원래 페이지에서 요청한 것처럼 Referer를 만든다. 이미지 서버가 Referer로 다른 사이트의 퍼가기를 막는 경우가 많다
  // (예: dcinside 이미지는 dcinside 페이지의 Referer가 있어야 받아진다).
  // 브라우저 기본 정책처럼 같은 사이트면 전체 주소, 다른 사이트면 origin만 보낸다.
  // 주소창에서 바로 연 페이지 등은 원래 사이트 안에서 이동한 것처럼 보이게 한다
  if (!page) headers.set('referer', target.origin + '/');
  else headers.set('referer', page.origin === target.origin ? page.href : page.origin + '/');
  // fetch·폼 전송의 Origin도 워커가 아니라 원래 페이지의 사이트로 맞춘다(API가 Origin을 검사한다)
  if (incoming.has('origin')) headers.set('origin', (page ?? target).origin);
  return headers;
}

// 요청을 보낸 페이지(Referer)의 원래 주소. 워커를 거친 페이지가 아니면 null
function originalPage(referer, proxyOrigin) {
  const from = parseProxyUrl(referer, proxyOrigin);
  try {
    return from ? new URL(from.raw) : null;
  } catch {
    return null;
  }
}

function text(body, status) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
