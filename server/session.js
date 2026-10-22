import { WebSocket } from 'ws';

// ====== 옵션 ======
const HOME_URL = process.env.HOME_URL || 'https://www.bing.com/';
const SEARCH_URL = 'https://www.bing.com/search?q=';

// 페이지 확대율(이전 WinForms 버전의 ZoomFactor 0.85와 동일)
const ZOOM = Number(process.env.ZOOM) || 0.85;

// 페이지 로드 완료 후 가로 스크롤 위치(px)
const INITIAL_SCROLL_X = 170;

// true: input/textarea/contenteditable에 커서가 있을 때는 Q/W/A/S 단축키를 무시(타이핑 방해 방지)
const IGNORE_HOTKEY_WHILE_TYPING = true;

// 마우스 휠 한 칸이 스크롤하는 거리(Chromium 기본값)
const WHEEL_NOTCH_PX = 100;

const JPEG_QUALITY = 75;

// 모든 문서(iframe 포함)에 주입: Q/W/A/S를 가로채서 서버의 __mm2Hotkey로 전달
const HOTKEY_SCRIPT = `(() => {
  const IGNORE_TYPING = ${IGNORE_HOTKEY_WHILE_TYPING};

  window.addEventListener('keydown', (e) => {
    const key = (e.key || '').toLowerCase();
    if (key !== 'q' && key !== 'w' && key !== 'a' && key !== 's') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (IGNORE_TYPING) {
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return;
    }

    try {
      window.__mm2Hotkey(key);
    } catch (_) {}

    e.preventDefault();
    e.stopPropagation();
  }, true);
})();`;

const MOUSE_BUTTONS = new Set(['left', 'middle', 'right']);

/**
 * 브라우저 탭 하나(WebSocket 연결 하나)에 대응하는 원격 브라우저 세션.
 * Chromium 화면을 JPEG로 스트리밍하고, 클라이언트의 마우스·키보드 입력을 그대로 재현한다.
 */
export class BrowserSession {
  constructor(browser, id) {
    this.browser = browser;
    this.id = id;
    this.ws = null;
    this.context = null;
    this.pages = []; // 팝업(새 창)은 스택처럼 쌓고, 닫히면 이전 페이지로 돌아간다
    this.page = null;
    this.cdp = null;
    this.width = 1280; // 클라이언트 캔버스 크기(CSS px)
    this.height = 720;
    this.dpr = 1;
    this.mouse = { x: 0, y: 0 }; // 마지막 마우스 위치(페이지 좌표). Q 단축키가 여기를 클릭한다
    this.pendingMove = null;
    this.pendingWheel = null;
    this.inputQueue = Promise.resolve();
    this.expireTimer = null;
    this.closed = false;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async attach(ws, { width, height, dpr, lang }) {
    this.ws = ws;
    this.send({ type: 'session', id: this.id });
    this.setSize(width, height);

    if (this.context) {
      await this.applySize();
    } else {
      this.dpr = clamp(Number(dpr) || 1, 1, 2);
      await this.start(typeof lang === 'string' ? lang : undefined);
    }
    this.sendState();
  }

  // 현재 연결된 소켓이었으면 true
  detach(ws) {
    if (this.ws !== ws) return false;
    this.ws = null;
    return true;
  }

  async dispose() {
    this.closed = true;
    await this.context?.close().catch(() => {});
  }

  async start(locale) {
    const options = {
      viewport: this.viewport(),
      // ZOOM으로 축소해도 화면 픽셀 수가 클라이언트 캔버스와 같아지도록 맞춘다
      deviceScaleFactor: ZOOM * this.dpr,
    };
    try {
      this.context = await this.browser.newContext({ ...options, locale });
    } catch {
      this.context = await this.browser.newContext(options);
    }

    await this.context.exposeBinding('__mm2Hotkey', (_source, key) => this.hotkey(key));
    await this.context.addInitScript(HOTKEY_SCRIPT);
    this.context.on('page', (page) => this.addPage(page));

    await this.context.newPage();
    this.navigate(HOME_URL);
  }

  // ===== 클라이언트 → 서버 메시지 =====

  handle(msg) {
    if (!this.page || !msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'navigate':
        this.navigate(msg.url);
        break;
      case 'home':
        this.navigate(HOME_URL);
        break;
      case 'back':
        this.goBack();
        break;
      case 'forward':
        this.page.goForward({ waitUntil: 'commit' }).catch(() => {});
        break;
      case 'reload':
        this.page.reload({ waitUntil: 'commit' }).catch(() => {});
        break;
      case 'resize':
        this.setSize(msg.width, msg.height);
        this.applySize();
        break;

      case 'mousemove':
        this.pendingMove = this.toPage(msg);
        this.enqueue(() => this.flushMove());
        break;
      case 'mousedown':
      case 'mouseup': {
        const button = MOUSE_BUTTONS.has(msg.button) ? msg.button : 'left';
        const clickCount = clamp(Number(msg.clicks) || 1, 1, 3);
        const point = this.toPage(msg);
        this.pendingMove = null;
        this.enqueue(async () => {
          await this.moveTo(point);
          if (msg.type === 'mousedown') await this.page.mouse.down({ button, clickCount });
          else await this.page.mouse.up({ button, clickCount });
        });
        break;
      }
      case 'wheel': {
        const wheel = this.pendingWheel ?? { dx: 0, dy: 0 };
        wheel.dx += (Number(msg.dx) || 0) / ZOOM;
        wheel.dy += (Number(msg.dy) || 0) / ZOOM;
        wheel.point = this.toPage(msg);
        this.pendingWheel = wheel;
        this.enqueue(() => this.flushWheel());
        break;
      }

      case 'keydown':
        if (typeof msg.key === 'string') this.enqueue(() => this.page.keyboard.down(msg.key));
        break;
      case 'keyup':
        if (typeof msg.key === 'string') this.enqueue(() => this.page.keyboard.up(msg.key));
        break;
      case 'press':
        if (typeof msg.key === 'string') this.enqueue(() => this.page.keyboard.press(msg.key));
        break;
      case 'char':
        // US 배열 문자는 실제 키 이벤트로(페이지의 Q/W/A/S 감지용), 그 밖의 문자는 텍스트 입력으로 처리된다
        if (typeof msg.text === 'string') this.enqueue(() => this.page.keyboard.type(msg.text));
        break;
      case 'text':
        // IME 확정 문자열, 붙여넣기
        if (typeof msg.text === 'string') this.enqueue(() => this.page.keyboard.insertText(msg.text));
        break;
    }
  }

  // Q: 커서 위치 좌클릭 / W: 뒤로 가기 / A: 위로 스크롤 / S: 아래로 스크롤
  hotkey(key) {
    switch (key) {
      case 'q':
        this.enqueue(() => this.page.mouse.click(this.mouse.x, this.mouse.y));
        break;
      case 'w':
        this.goBack();
        break;
      case 'a':
        this.enqueue(() => this.page.mouse.wheel(0, -WHEEL_NOTCH_PX * 2));
        break;
      case 's':
        this.enqueue(() => this.page.mouse.wheel(0, WHEEL_NOTCH_PX * 5));
        break;
    }
  }

  // ===== 탐색 =====

  navigate(input) {
    const url = normalizeUrl(input);
    if (!url) {
      this.send({ type: 'status', text: 'URL 오류: 올바르지 않은 주소입니다.' });
      return;
    }

    this.page.goto(url, { waitUntil: 'commit' }).catch((err) => {
      const message = String(err?.message ?? err).split('\n')[0];
      // 다른 탐색으로 중단된 경우는 오류가 아님
      if (/interrupted|ERR_ABORTED|frame was detached/i.test(message)) return;
      this.send({ type: 'status', text: `오류: ${message}`, loading: false });
    });
  }

  goBack() {
    this.page.goBack({ waitUntil: 'commit' }).catch(() => {});
  }

  // ===== 페이지(탭) 관리 =====

  addPage(page) {
    this.pages.push(page);

    page.on('close', () => this.removePage(page));
    page.on('framenavigated', (frame) => {
      if (page === this.page && frame === page.mainFrame()) this.sendState();
    });
    page.on('request', (request) => {
      if (page === this.page && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        this.send({ type: 'state', loading: true });
      }
    });
    page.on('load', () => this.onLoad(page));
    // alert/confirm 등은 화면에 표시할 수 없으므로 상태 표시줄에 내용을 보여 주고 자동 수락
    page.on('dialog', (dialog) => {
      if (page === this.page && dialog.message()) this.send({ type: 'status', text: `[알림] ${dialog.message()}` });
      dialog.accept().catch(() => {});
    });

    this.activate(page);
  }

  removePage(page) {
    this.pages = this.pages.filter((p) => p !== page);
    if (this.closed || page !== this.page) return;

    const previous = this.pages.at(-1);
    if (previous) {
      this.activate(previous);
    } else {
      // 마지막 페이지가 window.close() 등으로 닫히면 홈으로 새로 연다
      this.page = null;
      this.context.newPage().then(() => this.navigate(HOME_URL)).catch(() => {});
    }
  }

  async activate(page) {
    this.page = page;
    this.pendingMove = null;
    this.pendingWheel = null;

    const old = this.cdp;
    this.cdp = null;
    if (old) {
      await old.send('Page.stopScreencast').catch(() => {});
      await old.detach().catch(() => {});
    }

    await page.setViewportSize(this.viewport()).catch(() => {});
    await page.bringToFront().catch(() => {});
    if (this.page !== page) return;

    const cdp = await this.context.newCDPSession(page).catch(() => null);
    if (!cdp) return;
    if (this.page !== page) {
      cdp.detach().catch(() => {});
      return;
    }

    this.cdp = cdp;
    cdp.on('Page.screencastFrame', ({ data, sessionId }) => this.onFrame(cdp, data, sessionId));
    await this.startScreencast();
    this.sendState();
  }

  onLoad(page) {
    if (page === this.page) this.sendState({ loading: false });
    page.evaluate((x) => window.scrollTo(x, window.scrollY || 0), INITIAL_SCROLL_X).catch(() => {});
  }

  // ===== 화면 스트리밍 =====

  async startScreencast() {
    const cdp = this.cdp;
    if (!cdp) return;

    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp
      .send('Page.startScreencast', {
        format: 'jpeg',
        quality: JPEG_QUALITY,
        maxWidth: Math.round(this.width * this.dpr),
        maxHeight: Math.round(this.height * this.dpr),
      })
      .catch(() => {});
  }

  onFrame(cdp, data, sessionId) {
    const ack = () => cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});

    if (cdp !== this.cdp || !this.connected) {
      ack();
      return;
    }
    // 전송이 끝난 뒤에 ACK → 회선이 느리면 Chromium이 프레임 생성을 자동으로 늦춘다
    this.ws.send(Buffer.from(data, 'base64'), ack);
  }

  setSize(width, height) {
    this.width = clamp(Math.round(Number(width) || this.width), 200, 3840);
    this.height = clamp(Math.round(Number(height) || this.height), 150, 2160);
  }

  async applySize() {
    await Promise.all(this.pages.map((page) => page.setViewportSize(this.viewport()).catch(() => {})));
    await this.startScreencast();
  }

  viewport() {
    return { width: Math.round(this.width / ZOOM), height: Math.round(this.height / ZOOM) };
  }

  // ===== 입력 =====

  // 입력 순서를 보장하기 위해 하나씩 순서대로 실행
  enqueue(task) {
    this.inputQueue = this.inputQueue.then(() => (this.page ? task() : undefined)).catch(() => {});
  }

  // 클라이언트 캔버스 좌표(CSS px) → 페이지 좌표
  toPage({ x, y }) {
    return { x: (Number(x) || 0) / ZOOM, y: (Number(y) || 0) / ZOOM };
  }

  async moveTo(point) {
    this.mouse = point;
    await this.page.mouse.move(point.x, point.y);
  }

  // 쌓인 이동·휠 이벤트는 마지막 것만(휠은 합산해서) 처리
  async flushMove() {
    const point = this.pendingMove;
    if (!point) return;
    this.pendingMove = null;
    await this.moveTo(point);
  }

  async flushWheel() {
    const wheel = this.pendingWheel;
    if (!wheel) return;
    this.pendingWheel = null;
    await this.moveTo(wheel.point);
    await this.page.mouse.wheel(wheel.dx, wheel.dy);
  }

  // ===== 서버 → 클라이언트 메시지 =====

  async sendState(extra = {}) {
    const page = this.page;
    if (!page) return;
    const title = await page.title().catch(() => '');
    if (page !== this.page) return;
    this.send({ type: 'state', url: page.url(), title, tabs: this.pages.length, ...extra });
  }

  send(msg) {
    if (this.connected) this.ws.send(JSON.stringify(msg));
  }
}

// 주소창 입력 → URL. 스킴이 없으면 https://, 주소로 보이지 않으면 검색어로 취급
export function normalizeUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  let candidate;
  if (/^(https?:\/\/|about:)/i.test(text)) {
    candidate = text;
  } else if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(text)) {
    candidate = 'http://' + text;
  } else if (/\s/.test(text) || !text.includes('.')) {
    return SEARCH_URL + encodeURIComponent(text);
  } else {
    candidate = 'https://' + text;
  }

  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
