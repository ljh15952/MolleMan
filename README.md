# GoogleBrowser

**서버 없이 브라우저만으로 동작하는 웹 브라우저 페이지**입니다.
주소창에 입력한 페이지를 iframe 안에 띄웁니다. HTML·CSS·JS 파일뿐이라 GitHub Pages에 무료로 올릴 수 있고, 티스토리 같은 블로그 글에 넣어서 쓸 수도 있습니다.

> 사이트는 **항상 [프록시(Cloudflare Worker)](#프록시cloudflare-worker)를 거쳐서만** 열립니다. 접근 키가 없으면 아무 사이트도 열리지 않습니다.

## GitHub Pages에 올리기

1. 이 저장소를 GitHub에 push합니다.
2. 저장소의 **Settings → Pages**에서 **Source: Deploy from a branch**, **Branch: `main`**, 폴더 **`/docs`** 를 고르고 **Save**를 누릅니다.
3. 1~2분 뒤 `https://ljh15952.github.io/MolleMan/` 에서 열립니다. 그다음부터는 push할 때마다 자동으로 반영됩니다.

## 티스토리에 넣기

글쓰기 화면 오른쪽 위의 **기본모드**를 **HTML**로 바꾼 뒤 아래 코드를 붙여 넣습니다.

```html
<iframe src="https://ljh15952.github.io/MolleMan/" style="width:100%;height:80vh;border:0"></iframe>
```

## 내 PC에서 열기

```bash
python -m http.server 8000 --directory docs
```

실행한 뒤 브라우저에서 `http://localhost:8000` 을 엽니다.

## 사용법

- 주소창에 URL 또는 검색어를 입력하고 Enter 또는 **Go**를 누릅니다. 주소가 아닌 입력은 Google에서 검색합니다.
- **← → ⟳ Home** 버튼으로 탐색합니다. 시작 페이지는 Google입니다.
- **🔑** 버튼으로 프록시 접근 키를 입력합니다. 키가 저장되어 있지 않으면 페이지를 열 때 자동으로 묻습니다.
- 하단 상태 표시줄의 **밝기** 슬라이더(10~100%, 기본 19%)로 화면을 어둡게 할 수 있습니다. 마지막 값은 브라우저에 기억됩니다.
- 페이지는 이전 버전과 같이 0.85배로 축소해서 보여 줍니다.

### 키보드 단축키

iframe 안을 클릭하면 키 입력이 그 사이트로 가기 때문에, 아래 단축키는 툴바 등 이 페이지에 포커스가 있을 때만 동작합니다.
주소창에서 Enter로 이동한 직후에는 바로 쓸 수 있습니다.

| 키 | 동작 |
|----|------|
| `W` | 뒤로 가기 (입력란에 포커스가 있을 때는 무시) |
| `F5` / `Ctrl+R` | 새로고침 |
| `Alt+←` / `Alt+→` | 뒤로 / 앞으로 |
| `Ctrl+L` | 주소창으로 이동 |

## 설정

[docs/app.js](docs/app.js) 맨 위에서 바꿀 수 있습니다.

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `HOME_URL` | `https://www.google.com/webhp?igu=1` | 시작·Home 페이지 |
| `SEARCH_URL` | `https://www.google.com/search?igu=1&q=` | 검색 주소 |
| `ZOOM` | `0.85` | 페이지 확대율(이전 버전과 동일) |
| `PROXY_URL` | `https://protect.ljh240310.date` | 사이트를 대신 가져다 주는 Cloudflare Worker 주소. 바꾸면 [docs/index.html](docs/index.html)의 `Content-Security-Policy`(`frame-src`)도 같은 주소로 바꿔야 합니다 |

## 프록시(Cloudflare Worker)

모든 사이트는 [worker/](worker) 폴더의 Cloudflare Worker를 거쳐서 열립니다.
워커가 페이지를 대신 가져오면서 삽입을 막는 헤더(`X-Frame-Options`, CSP)를 지우고, 페이지 안의 링크·이미지·CSS 주소를 워커 주소로 바꿉니다.

프록시 없이 사이트에 직접 접속하는 일이 없도록 아래처럼 막아 두었습니다.

- 접근 키가 없으면 앱이 iframe에 아무 주소도 넣지 않습니다.
- [docs/index.html](docs/index.html)의 CSP(`frame-src`) 때문에, iframe에는 워커 주소 말고는 브라우저가 열지 않습니다.
- 워커가 돌려주는 페이지에는 워커 자신의 CSP(`default-src 'self'`)가 붙습니다. 그래서 페이지의 JS가 만든 주소라도 워커 밖으로는 직접 요청하지 못합니다(이미지·스크립트·fetch·폼 전송 포함).
- 새 창(팝업)은 막혀 있고, `target="_blank"` 링크도 iframe 안에서 열립니다.

1. [Cloudflare](https://dash.cloudflare.com/sign-up)에 무료 가입합니다.
2. 배포합니다. 처음에는 브라우저가 열리며 Cloudflare 로그인을 묻습니다.
   ```bash
   cd worker
   npx wrangler deploy
   ```
3. **접근 키**를 정합니다. 키를 아는 사람만 워커를 쓸 수 있고, 키를 넣지 않으면 워커는 아무 요청도 받지 않습니다. 영문·숫자·`_`·`-`로 16자 이상(길수록 안전)을 입력합니다. 키는 저장소에 올라가지 않고 Cloudflare에만 저장됩니다.
   ```bash
   npx wrangler secret put ACCESS_KEY
   ```
   그다음 브라우저 페이지의 **🔑** 버튼을 눌러 같은 키를 입력합니다. 키는 그 브라우저에만 저장되며, 키가 없으면 사이트가 열리지 않습니다. 키가 새어 나갔다고 생각되면 위 명령으로 바꾸고 🔑에 새 키를 넣으면 됩니다.
4. 워커는 `https://protect.ljh240310.date`에서 열립니다([docs/app.js](docs/app.js)의 `PROXY_URL`에 이미 들어 있음). 이 도메인의 DNS가 Cloudflare에 있어야 하며, DNS 레코드와 인증서는 배포할 때 자동으로 만들어집니다. 도메인을 쓰지 않으려면 `wrangler.toml`의 `routes`를 지우고, 출력된 `workers.dev` 주소를 `PROXY_URL`에 넣습니다.

- 도메인 주소는 `wrangler.toml`의 `routes`에서 바꿉니다. `workers.dev` 주소의 `proxy` 부분은 `name`, 가운데 부분은 Cloudflare 대시보드 **Workers & Pages**의 계정 서브도메인입니다.
- 내 PC에서 시험: `worker/.dev.vars` 파일에 `ACCESS_KEY=<키>`를 적고 `cd worker` 후 `npx wrangler dev` → `http://localhost:8787/p/<키>/https://example.com`
- 키는 페이지 주소(`/p/<키>/...`)에 들어갑니다. 워커가 다른 사이트로 Referer를 보내지 않게 막지만, 주소를 남에게 복사해 주면 키도 함께 넘어갑니다.
- 로그인·쿠키가 필요한 사이트, JS로 화면을 그리는 큰 사이트(Naver, YouTube 등)는 이 방식으로도 대부분 동작하지 않습니다. JS가 만든 다른 사이트 주소는 CSP로 막히므로 일부 기능이 빠질 수 있습니다.
- Google 검색도 워커(Cloudflare 서버)에서 요청하므로, Google이 자동 요청으로 판단해 확인 화면을 띄울 수 있습니다.
- 페이지 안의 이미지·CSS도 모두 워커를 거치므로 요청 수가 많습니다(무료 플랜은 하루 10만 건).

## 프로젝트 구조

| 파일 | 설명 |
|------|------|
| `docs/index.html` / `style.css` / `app.js` | 브라우저 UI 전체. GitHub Pages가 이 폴더를 그대로 공개합니다 |
| `worker/` | 모든 사이트를 대신 가져오는 프록시(Cloudflare Worker, 필수) |
| `docs/.nojekyll` | GitHub Pages의 Jekyll 변환을 끄는 빈 파일 |
| `GoogleBrowser/`, `GoogleBrowser.sln` | 이전 버전(Windows WinForms + WebView2) |

## 제한 사항

iframe과 프록시로 띄우는 방식이라 아래 제한이 있습니다.

- iframe 안에서 링크로 이동한 주소는 주소창에 나오지 않습니다. 그래서 **⟳ 새로고침**은 주소창의 주소를 엽니다.
- 이전 버전의 `Q`(커서 위치 클릭), `A`/`S`(스크롤), 로드 후 가로 스크롤(170px)은 다른 사이트 안을 조작해야 해서 뺐습니다.
- 대부분의 사이트에서 로그인이 유지되지 않습니다. 브라우저가 다른 페이지 안에 들어간 사이트의 쿠키를 제한하기 때문입니다.
- 새 창(팝업)은 열리지 않습니다. `target="_blank"` 링크는 iframe 안에서 열리지만, JS로 여는 팝업은 동작하지 않습니다.

## 이전 버전

- **서버 버전**: 서버에서 헤드리스 Chromium을 실행해 화면을 스트리밍하던 버전(모든 사이트와 Q/W/A/S 단축키 지원, 서버 필요)은 커밋 `fcc7f52`까지의 git 기록에 남아 있습니다.
- **WinForms 버전**: `GoogleBrowser/` 폴더에 Windows 전용 WinForms + WebView2 버전이 그대로 남아 있습니다.
  Visual Studio에서 `GoogleBrowser.sln`을 열어 빌드할 수 있습니다(.NET Framework 4.6.2, WebView2 Runtime 필요).
