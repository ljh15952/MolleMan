// 주소창에 입력한 페이지를 iframe에 띄운다. 서버 없이 브라우저만으로 동작한다.
// 다른 사이트(iframe 안)의 내용·주소는 브라우저 보안상 읽거나 조작할 수 없으므로,
// 탐색은 iframe 이동과 이 페이지의 브라우저 기록(뒤로/앞으로)으로만 처리한다.

const $ = (id) => document.getElementById(id);

const viewportEl = $('viewport');
const frame = $('frame');
const address = $('address');
const statusEl = $('status');
const spinner = $('spinner');
const brightness = $('brightness');
const brightnessValue = $('brightness-value');
const dimmer = $('dimmer');

// ====== 옵션 ======
// Google은 igu=1을 붙이면 다른 페이지 안(iframe)에 표시하는 것을 허용한다. Bing 첫 화면은 막혀 있다
const HOME_URL = 'https://www.google.com/webhp?igu=1';
const SEARCH_URL = 'https://www.google.com/search?igu=1&q=';

// 페이지 확대율(이전 WinForms 버전의 ZoomFactor 0.85와 동일)
const ZOOM = 0.85;

// 모든 사이트를 대신 가져다 주는 Cloudflare Worker 주소(worker 폴더). 사이트는 항상 이 워커를 거쳐서만 연다.
// 바꾸면 index.html의 Content-Security-Policy(frame-src)도 같은 주소로 바꿔야 한다
const PROXY_URL = 'https://protect.ljh240310.date';

const BRIGHTNESS_KEY = 'mm2-brightness';

// 워커 접근 키. 이 파일은 공개되므로 키는 여기에 적지 않고 🔑 버튼으로 입력해 이 브라우저에만 저장한다
const PROXY_KEY_KEY = 'mm2-proxy-key';
let proxyKey = loadSetting(PROXY_KEY_KEY) ?? '';

// 마지막으로 주소창·홈으로 연 주소. iframe 안에서 링크로 이동한 주소는 알 수 없다
let currentUrl = '';

viewportEl.style.setProperty('--zoom', ZOOM);

// ===== 탐색 =====

function navigate(input) {
  const url = normalizeUrl(input);
  if (!url) {
    setStatus('URL 오류: 올바르지 않은 주소입니다.');
    return;
  }

  currentUrl = url;
  address.value = url;
  if (!proxyKey) {
    setStatus('🔑 버튼으로 접근 키를 입력해야 사이트를 열 수 있습니다.');
    return;
  }
  setLoading(true);
  frame.src = frameUrl(url);
}

// iframe에 실제로 넣을 주소. 항상 워커를 거친다(키가 없을 때는 navigate가 열지 않는다)
function frameUrl(url) {
  return PROXY_URL.replace(/\/+$/, '') + '/p/' + proxyKey + '/' + url;
}

function askProxyKey() {
  const input = prompt('프록시 접근 키를 입력하세요. 키가 없으면 사이트를 열 수 없습니다.', proxyKey);
  if (input === null) return;
  proxyKey = input.trim();
  saveSetting(PROXY_KEY_KEY, proxyKey);
  if (currentUrl) navigate(currentUrl);
}

// 다른 사이트의 현재 주소는 읽을 수 없으므로 주소창의 주소를 다시 연다(기록은 늘리지 않는다)
function reload() {
  if (!currentUrl || !proxyKey) return;
  setLoading(true);
  frame.contentWindow.location.replace(frameUrl(currentUrl));
}

// iframe 안에서 이동한 기록도 이 페이지의 브라우저 기록에 함께 쌓이므로 history로 뒤로/앞으로 간다.
// 맨 앞에 표시용 기록을 하나 두고, 뒤로 가기가 거기까지 오면 다시 앞으로 보내서 이 페이지를 벗어나지 않게 한다.
history.replaceState({ mm2: 'start' }, '');
history.pushState({ mm2: 'app' }, '');

window.addEventListener('popstate', (e) => {
  if (e.state?.mm2 === 'start') history.forward();
});

function goBack() {
  history.back();
}

function goForward() {
  history.forward();
}

// iframe 안에서 링크로 이동하거나 뒤로/앞으로 가도 load는 온다.
// 사이트가 삽입을 막은 경우에도 오류 화면이 load되므로 구분할 수 없어 안내만 한다
frame.addEventListener('load', () => {
  if (currentUrl) setLoading(false);
});

function setLoading(loading) {
  spinner.hidden = !loading;
  setStatus(loading ? '로딩 중…' : '완료');
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.title = text;
}

// ===== 키보드 =====

// iframe 안을 클릭하면 키 입력이 그 사이트로 가므로, 아래 단축키는 이 페이지(툴바 등)에 포커스가 있을 때만 동작한다.
// Q/W/A/S는 iframe 안에 포커스가 있을 때 워커가 넣은 스크립트가 직접 처리한다
window.addEventListener('keydown', (e) => {
  if (e.isComposing) return;

  const mod = e.ctrlKey || e.metaKey;
  const lower = e.key.toLowerCase();

  if (e.key === 'F5' || (mod && lower === 'r')) {
    e.preventDefault();
    reload();
  } else if (e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    goBack();
  } else if (e.altKey && e.key === 'ArrowRight') {
    e.preventDefault();
    goForward();
  } else if (mod && lower === 'l') {
    e.preventDefault();
    address.focus();
    address.select();
  } else if (lower === 'w' && !mod && !e.altKey && !isTyping(e.target)) {
    // W: 뒤로 가기(입력란에 포커스가 있을 때는 무시)
    e.preventDefault();
    goBack();
  } else if ((lower === 'q' || lower === 'a' || lower === 's') && !mod && !e.altKey && !isTyping(e.target)) {
    // Q: 커서 위치 클릭, A/S: 위/아래 스크롤. 다른 사이트 안은 직접 조작할 수 없으므로 워커가 넣은 스크립트에 부탁한다
    e.preventDefault();
    frame.contentWindow?.postMessage({ mm2Hotkey: lower }, new URL(PROXY_URL).origin);
  }
});

function isTyping(target) {
  const tag = target?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || Boolean(target?.isContentEditable);
}

// ===== 툴바 =====

$('back').addEventListener('click', goBack);
$('forward').addEventListener('click', goForward);
$('reload').addEventListener('click', reload);
$('home').addEventListener('click', () => navigate(HOME_URL));
$('proxy-key').addEventListener('click', askProxyKey);

$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = address.value.trim();
  if (!url) return;
  navigate(url);
  // 이동 후 바로 W를 쓸 수 있도록 주소창에서 포커스를 뺀다
  viewportEl.focus({ preventScroll: true });
});

address.addEventListener('focus', () => address.select());

// ===== 밝기 =====

// iframe 위에 검은 막을 겹쳐 화면만 어둡게 한다. 값은 이 브라우저에 기억된다.
// iframe에 CSS filter를 걸면 다른 사이트 화면의 일부(이미지 등)에만 적용되는 경우가 있어 쓰지 않는다
function applyBrightness() {
  const value = Number(brightness.value);
  dimmer.style.opacity = String(1 - value / 100);
  brightnessValue.textContent = `${value}%`;
}

const savedBrightness = loadSetting(BRIGHTNESS_KEY);
if (savedBrightness !== null) brightness.value = savedBrightness;
applyBrightness();

brightness.addEventListener('input', () => {
  applyBrightness();
  saveSetting(BRIGHTNESS_KEY, brightness.value);
});

// 저장된 값을 읽을 수 없으면 null(기본값을 쓴다)
function loadSetting(name) {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

// 저장할 수 없으면 다음에 열 때 기본값으로 돌아간다
function saveSetting(name, value) {
  try {
    localStorage.setItem(name, value);
  } catch {
    // 무시
  }
}

// 마우스로 조절한 뒤에도 바로 W를 쓸 수 있도록 슬라이더에서 포커스를 뺀다
brightness.addEventListener('pointerup', () => viewportEl.focus({ preventScroll: true }));

// ===== 주소 =====

// 주소창 입력 → URL. 스킴이 없으면 https://, 주소로 보이지 않으면 검색어로 취급.
// 워커는 http/https만 가져오므로 다른 스킴은 받지 않는다
function normalizeUrl(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  let candidate;
  if (/^https?:\/\//i.test(text)) {
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

if (!proxyKey) askProxyKey();
navigate(HOME_URL);
