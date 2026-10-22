# GoogleBrowser

**GitHub Codespaces에서 동작하는 웹 브라우저**입니다.
서버(Codespace)에서 헤드리스 Chromium을 실행하고, 그 화면을 브라우저 탭으로 실시간 스트리밍합니다.
마우스·키보드 입력은 그대로 원격 Chromium에 전달되며, 이전 WinForms 버전의 Q/W/A/S 단축키도 똑같이 동작합니다.

```
[내 브라우저 탭]  ── 마우스/키보드(WebSocket) ──▶  [Codespace: Node.js 서버 + 헤드리스 Chromium]
   canvas 화면     ◀── JPEG 화면 프레임(WebSocket) ──
```

iframe 방식과 달리 X-Frame-Options 등으로 삽입을 막는 사이트(Bing, Google 등)도 정상적으로 열립니다.

## Codespaces에서 실행

1. GitHub 저장소 페이지에서 **Code → Codespaces → Create codespace on main**을 누릅니다.
2. 처음 생성할 때 `.devcontainer/setup.sh`가 자동으로 실행되어 의존성, Chromium, CJK 폰트를 설치합니다(몇 분 걸립니다).
3. 설치가 끝나면 서버가 자동으로 시작되고 **포트 3000**이 새 탭으로 열립니다.
   - 열리지 않으면 VS Code 하단의 **포트** 탭에서 3000번 옆의 🌐 아이콘을 누르세요.
   - 서버를 수동으로 시작하려면 터미널에서 `npm start`를 실행합니다.

> 포트는 기본적으로 **비공개**(본인 GitHub 계정만 접속 가능)입니다. 이 서버는 누구나 쓸 수 있는 브라우저이므로 공개로 바꾸지 마세요.

## 사용법

- 주소창에 URL 또는 검색어를 입력하고 Enter 또는 **Go**를 누릅니다. 주소가 아닌 입력은 Bing에서 검색합니다.
- **← → ⟳ Home** 버튼으로 탐색합니다. 시작 페이지는 Bing입니다.
- 화면을 클릭하면 페이지로 키보드 포커스가 이동합니다.
- 한국어·일본어 IME 입력과 붙여넣기(Ctrl+V, 이 PC의 클립보드 내용)를 지원합니다.
- 새 창(팝업)은 같은 화면에서 열리고, 그 창이 닫히면 이전 페이지로 돌아갑니다.
- 브라우저 탭을 새로고침하거나 연결이 잠깐 끊겨도 60초 안에 다시 연결하면 보던 페이지가 유지됩니다.
- 하단 상태 표시줄의 **밝기** 슬라이더(10~100%, 기본 19%)로 화면을 어둡게 할 수 있습니다. 마지막 값은 브라우저에 기억됩니다.
- 페이지 로드가 끝나면 가로로 170px 스크롤합니다(이전 버전과 동일). 페이지가 화면보다 넓을 때만 효과가 있습니다.

### 키보드 단축키

모든 페이지(iframe 포함)에 스크립트를 주입해 아래 키를 가로챕니다.
(입력란 `input` / `textarea` / `contenteditable`에 포커스가 있을 때는 무시합니다.)

| 키 | 동작 |
|----|------|
| `Q` | 현재 마우스 커서 위치에서 좌클릭 |
| `W` | 뒤로 가기 |
| `A` | 위로 스크롤 |
| `S` | 아래로 스크롤 |
| `F5` / `Ctrl+R` | 새로고침 |
| `Alt+←` / `Alt+→` | 뒤로 / 앞으로 |
| `Ctrl+L` | 주소창으로 이동 |

## 설정

환경 변수로 바꿀 수 있습니다.

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3000` | 서버 포트 |
| `HOME_URL` | `https://www.bing.com/` | 시작·Home 페이지 |
| `ZOOM` | `0.85` | 페이지 확대율(이전 버전과 동일) |
| `BROWSER_CHANNEL` | (없음) | `chrome`, `msedge` 등 설치된 브라우저 사용 |

그 밖의 옵션(로드 후 가로 스크롤 위치, 단축키 스크롤 양 등)은 [server/session.js](server/session.js) 맨 위에 있습니다.

## 프로젝트 구조

| 파일 | 설명 |
|------|------|
| `server/index.js` | HTTP(정적 파일) + WebSocket 서버, 세션 관리 |
| `server/session.js` | 원격 브라우저 세션: 화면 스트리밍(CDP screencast), 입력 재현, 단축키 |
| `public/index.html` / `style.css` / `app.js` | 브라우저 UI(툴바, 화면 캔버스, 입력 전달) |
| `.devcontainer/` | Codespaces 환경 설정과 초기 설치 스크립트 |
| `GoogleBrowser/`, `GoogleBrowser.sln` | 이전 버전(Windows WinForms + WebView2) |

## 제한 사항

- 원격 화면을 JPEG로 전송하므로 동영상이나 빠른 애니메이션은 끊겨 보일 수 있습니다. 소리는 나오지 않습니다.
- 원격 페이지에서 복사(Ctrl+C)한 내용은 이 PC의 클립보드로 오지 않습니다.
- 파일 다운로드·업로드는 지원하지 않습니다.
- 웹 페이지는 창 자체를 투명하게 만들 수 없으므로, 이전 버전의 창 투명도 슬라이더 대신 화면 밝기 슬라이더를 제공합니다.

## 이전 버전 (WinForms)

`GoogleBrowser/` 폴더에는 Windows 전용 WinForms + WebView2 버전이 그대로 남아 있습니다.
Visual Studio에서 `GoogleBrowser.sln`을 열어 빌드할 수 있습니다(.NET Framework 4.6.2, WebView2 Runtime 필요).
