// 서버의 원격 Chromium 화면을 캔버스에 그리고, 마우스·키보드 입력을 서버로 보낸다.

const $ = (id) => document.getElementById(id);

const viewportEl = $('viewport');
const canvas = $('screen');
const ctx = canvas.getContext('2d');
const sink = $('keyboard-sink');
const address = $('address');
const statusEl = $('status');
const spinner = $('spinner');
const overlay = $('overlay');
const brightness = $('brightness');
const brightnessValue = $('brightness-value');

const SESSION_KEY = 'mm2-session';
const BRIGHTNESS_KEY = 'mm2-brightness';
const MOUSE_BUTTONS = ['left', 'middle', 'right'];
const RESIZE_DEBOUNCE_MS = 150;

let ws = null;
let pageTitle = '';

// ===== 연결 =====

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.binaryType = 'blob';

  ws.addEventListener('open', () => {
    resizeCanvas();
    const { width, height } = viewportSize();
    send({
      type: 'init',
      sessionId: loadSessionId(),
      width,
      height,
      dpr: window.devicePixelRatio || 1,
      lang: navigator.language,
    });
  });

  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string') onMessage(JSON.parse(e.data));
    else drawFrame(e.data);
  });

  ws.addEventListener('close', () => {
    showOverlay('서버와 연결이 끊어졌습니다. 다시 연결하는 중…');
    setTimeout(connect, 1000);
  });
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function onMessage(msg) {
  switch (msg.type) {
    case 'session':
      saveSessionId(msg.id);
      break;
    case 'state':
      if (typeof msg.url === 'string' && document.activeElement !== address) address.value = msg.url;
      if (typeof msg.title === 'string') {
        pageTitle = msg.title;
        document.title = pageTitle ? `${pageTitle} - GoogleBrowser` : 'GoogleBrowser';
      }
      if (typeof msg.loading === 'boolean') setLoading(msg.loading);
      else if (spinner.hidden) setStatus(pageTitle || '완료');
      break;
    case 'status':
      if (typeof msg.loading === 'boolean') setLoading(msg.loading);
      setStatus(msg.text);
      break;
  }
}

function loadSessionId() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function saveSessionId(id) {
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    // 저장할 수 없으면 새로고침 시 새 세션으로 시작한다
  }
}

// ===== 화면 =====

let pendingFrame = null;
let decoding = false;

// 디코딩이 밀리면 중간 프레임은 버리고 가장 최근 프레임만 그린다
async function drawFrame(blob) {
  pendingFrame = blob;
  if (decoding) return;
  decoding = true;

  while (pendingFrame) {
    const frame = pendingFrame;
    pendingFrame = null;
    try {
      const bitmap = await createImageBitmap(frame);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      showOverlay(null);
    } catch {
      // 손상된 프레임은 무시
    }
  }
  decoding = false;
}

function viewportSize() {
  const rect = viewportEl.getBoundingClientRect();
  return { width: Math.round(rect.width), height: Math.round(rect.height) };
}

function resizeCanvas() {
  const { width, height } = viewportSize();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

let resizeTimer = null;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeCanvas();
    send({ type: 'resize', ...viewportSize() });
  }, RESIZE_DEBOUNCE_MS);
}).observe(viewportEl);

function showOverlay(text) {
  overlay.hidden = !text;
  if (text) overlay.textContent = text;
}

function setLoading(loading) {
  spinner.hidden = !loading;
  setStatus(loading ? '로딩 중…' : pageTitle || '완료');
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.title = text;
}

// ===== 마우스 =====

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: Math.round(e.clientX - rect.left), y: Math.round(e.clientY - rect.top) };
}

// 이동은 화면 갱신 주기에 맞춰 마지막 위치만 보낸다
let pendingMove = null;
canvas.addEventListener('mousemove', (e) => {
  const first = !pendingMove;
  pendingMove = canvasPoint(e);
  if (first) {
    requestAnimationFrame(() => {
      if (pendingMove) send({ type: 'mousemove', ...pendingMove });
      pendingMove = null;
    });
  }
});

const pressedButtons = new Set();

canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  sink.focus({ preventScroll: true });
  pendingMove = null;

  // 마우스 사이드 버튼: 뒤로/앞으로
  if (e.button === 3) return send({ type: 'back' });
  if (e.button === 4) return send({ type: 'forward' });

  const button = MOUSE_BUTTONS[e.button];
  if (!button) return;
  pressedButtons.add(button);
  send({ type: 'mousedown', button, clicks: e.detail || 1, ...canvasPoint(e) });
});

// 캔버스 밖에서 버튼을 놓아도 원격 쪽 버튼이 눌린 채로 남지 않도록 window에서 받는다
window.addEventListener('mouseup', (e) => {
  const button = MOUSE_BUTTONS[e.button];
  if (!button || !pressedButtons.delete(button)) return;
  send({ type: 'mouseup', button, clicks: e.detail || 1, ...canvasPoint(e) });
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? viewportSize().height : 1;
    send({ type: 'wheel', dx: e.deltaX * scale, dy: e.deltaY * scale, ...canvasPoint(e) });
  },
  { passive: false },
);

// ===== 키보드 =====

// code → 서버에 keydown으로 보낸 key (keyup 때 같은 key로 떼기 위해)
const downKeys = new Map();

sink.addEventListener('keydown', (e) => {
  // IME 조합 중인 키는 compositionend / input에서 처리
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return;

  const mod = e.ctrlKey || e.metaKey;
  const lower = e.key.toLowerCase();

  // 붙여넣기는 paste 이벤트에서 이 PC의 클립보드 내용을 보낸다
  if (mod && lower === 'v') return;

  // 브라우저 자체 단축키
  if (e.key === 'F5' || (mod && lower === 'r')) {
    e.preventDefault();
    return send({ type: 'reload' });
  }
  if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    return send({ type: 'back' });
  }
  if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    return send({ type: 'forward' });
  }
  if (mod && lower === 'l') {
    e.preventDefault();
    address.focus();
    address.select();
    return;
  }

  e.preventDefault();

  if (e.key.length === 1 && !mod && !e.altKey) {
    send({ type: 'char', text: e.key });
    return;
  }
  if (e.key === 'Unidentified' || e.key === 'Dead') return;

  downKeys.set(e.code, e.key);
  send({ type: 'keydown', key: e.key });
});

sink.addEventListener('keyup', (e) => {
  const key = downKeys.get(e.code);
  if (key === undefined) return;
  e.preventDefault();
  downKeys.delete(e.code);
  send({ type: 'keyup', key });
});

// 포커스를 잃으면 눌린 키(Shift 등)를 모두 뗀다
function releaseKeys() {
  for (const key of downKeys.values()) send({ type: 'keyup', key });
  downKeys.clear();
}
sink.addEventListener('blur', releaseKeys);

// 한국어·일본어 IME: 확정된 문자열만 보낸다
sink.addEventListener('compositionend', (e) => {
  if (e.data) send({ type: 'text', text: e.data });
  sink.value = '';
});

// 조합 종료 직후의 스페이스·엔터 등은 keydown 대신 input으로 들어온다
sink.addEventListener('input', (e) => {
  if (e.isComposing) return;
  if (e.inputType === 'insertText' && e.data) send({ type: 'text', text: e.data });
  else if (e.inputType === 'insertLineBreak') send({ type: 'press', key: 'Enter' });
  sink.value = '';
});

sink.addEventListener('paste', (e) => {
  e.preventDefault();
  const text = e.clipboardData?.getData('text/plain');
  if (text) send({ type: 'text', text });
});

// ===== 툴바 =====

$('back').addEventListener('click', () => send({ type: 'back' }));
$('forward').addEventListener('click', () => send({ type: 'forward' }));
$('reload').addEventListener('click', () => send({ type: 'reload' }));
$('home').addEventListener('click', () => {
  send({ type: 'home' });
  sink.focus({ preventScroll: true });
});

$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = address.value.trim();
  if (!url) return;
  send({ type: 'navigate', url });
  // 이동 후 바로 Q/W/A/S를 쓸 수 있도록 페이지로 포커스
  sink.focus({ preventScroll: true });
});

address.addEventListener('focus', () => address.select());

// ===== 밝기 =====

// 원격 화면(캔버스)만 어둡게 한다. 값은 이 브라우저에 기억된다
function applyBrightness() {
  const value = Number(brightness.value);
  canvas.style.filter = value < 100 ? `brightness(${value / 100})` : '';
  brightnessValue.textContent = `${value}%`;
}

try {
  const saved = localStorage.getItem(BRIGHTNESS_KEY);
  if (saved !== null) brightness.value = saved;
} catch {
  // 저장된 값을 읽을 수 없으면 기본값을 쓴다
}
applyBrightness();

brightness.addEventListener('input', () => {
  applyBrightness();
  try {
    localStorage.setItem(BRIGHTNESS_KEY, brightness.value);
  } catch {
    // 저장할 수 없으면 다음에 열 때 기본값으로 돌아간다
  }
});

// 마우스로 조절한 뒤에도 바로 Q/W/A/S를 쓸 수 있도록 페이지로 포커스
brightness.addEventListener('pointerup', () => sink.focus({ preventScroll: true }));

connect();
sink.focus({ preventScroll: true });
