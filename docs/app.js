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

// ====== 옵션 ======
// Google은 igu=1을 붙이면 다른 페이지 안(iframe)에 표시하는 것을 허용한다. Bing 첫 화면은 막혀 있다
const HOME_URL = 'https://www.google.com/webhp?igu=1';
const SEARCH_URL = 'https://www.google.com/search?igu=1&q=';

// 페이지 확대율(이전 WinForms 버전의 ZoomFactor 0.85와 동일)
const ZOOM = 0.85;

// 삽입을 막는 사이트를 대신 가져다 주는 Cloudflare Worker 주소(worker 폴더). 비워 두면 사이트를 직접 연다.
// 예: 'https://proxy.ljh15952.workers.dev'
const PROXY_URL = 'https://protect.ljh240310.date';

// 프록시 없이 직접 여는 사이트(igu=1로 삽입이 허용되는 Google)
const DIRECT_HOSTS = ['www.google.com', 'google.com'];

const BRIGHTNESS_KEY = 'mm2-brightness';

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
  setLoading(true);
  frame.src = frameUrl(url);
}

// iframe에 실제로 넣을 주소. 프록시를 설정했으면 워커를 거치게 한다
function frameUrl(url) {
  if (!PROXY_URL || !/^https?:/i.test(url)) return url;
  if (DIRECT_HOSTS.includes(new URL(url).hostname)) return url;
  return PROXY_URL.replace(/\/+$/, '') + '/p/' + url;
}

// 다른 사이트의 현재 주소는 읽을 수 없으므로 주소창의 주소를 다시 연다(기록은 늘리지 않는다)
function reload() {
  if (!currentUrl) return;
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
  setStatus(loading ? '로딩 중…' : '완료 · 화면이 안 나오면 ↗ 버튼으로 새 탭에서 여세요');
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.title = text;
}

// ===== 키보드 =====

// iframe 안을 클릭하면 키 입력이 그 사이트로 가므로, 아래 단축키는 이 페이지(툴바 등)에 포커스가 있을 때만 동작한다
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

$('open-tab').addEventListener('click', () => {
  if (currentUrl) window.open(currentUrl, '_blank', 'noopener');
});

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

// iframe 화면만 어둡게 한다. 값은 이 브라우저에 기억된다
function applyBrightness() {
  const value = Number(brightness.value);
  frame.style.filter = value < 100 ? `brightness(${value / 100})` : '';
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

// 마우스로 조절한 뒤에도 바로 W를 쓸 수 있도록 슬라이더에서 포커스를 뺀다
brightness.addEventListener('pointerup', () => viewportEl.focus({ preventScroll: true }));

// ===== 주소 =====

// 주소창 입력 → URL. 스킴이 없으면 https://, 주소로 보이지 않으면 검색어로 취급
function normalizeUrl(input) {
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

navigate(HOME_URL);
