# GoogleBrowser

**서버 없이 브라우저만으로 동작하는 웹 브라우저 페이지**입니다.
주소창에 입력한 페이지를 iframe 안에 띄웁니다. HTML·CSS·JS 파일뿐이라 GitHub Pages에 무료로 올릴 수 있고, 티스토리 같은 블로그 글에 넣어서 쓸 수도 있습니다.

> 사이트가 다른 페이지 안에 표시되는 것을 막아 두었으면(Naver, YouTube, Bing 첫 화면 등) 화면에 "연결을 거부했습니다"가 나옵니다.
> 브라우저 보안 규칙이라 서버 없이는 피할 수 없습니다. 이럴 때는 **↗** 버튼으로 새 탭에서 여세요.

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
- **↗** 버튼은 주소창의 주소를 새 탭에서 엽니다. 화면이 안 나오는 사이트에 쓰세요.
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

Google은 주소에 `igu=1`이 있어야 iframe 안에 표시됩니다. 이전 버전에서 쓰던 Bing은 첫 화면이 삽입을 막아서 Google로 바꿨습니다.

## 프로젝트 구조

| 파일 | 설명 |
|------|------|
| `docs/index.html` / `style.css` / `app.js` | 브라우저 UI 전체. GitHub Pages가 이 폴더를 그대로 공개합니다 |
| `docs/.nojekyll` | GitHub Pages의 Jekyll 변환을 끄는 빈 파일 |
| `GoogleBrowser/`, `GoogleBrowser.sln` | 이전 버전(Windows WinForms + WebView2) |

## 제한 사항

서버 없이 iframe으로 띄우는 방식이라 아래 제한이 있습니다.

- 삽입을 막은 사이트는 열리지 않습니다. 예: Naver, YouTube, Bing 첫 화면, DuckDuckGo, 나무위키. 검색 결과를 눌러 들어간 사이트도 마찬가지입니다.
- iframe 안에서 링크로 이동한 주소는 주소창에 나오지 않습니다. 그래서 **⟳ 새로고침**과 **↗ 새 탭**은 주소창의 주소를 엽니다.
- 이전 버전의 `Q`(커서 위치 클릭), `A`/`S`(스크롤), 로드 후 가로 스크롤(170px)은 다른 사이트 안을 조작해야 해서 뺐습니다.
- 대부분의 사이트에서 로그인이 유지되지 않습니다. 브라우저가 다른 페이지 안에 들어간 사이트의 쿠키를 제한하기 때문입니다.
- 새 창(팝업)으로 여는 링크는 브라우저의 새 탭으로 열립니다.

## 이전 버전

- **서버 버전**: 서버에서 헤드리스 Chromium을 실행해 화면을 스트리밍하던 버전(모든 사이트와 Q/W/A/S 단축키 지원, 서버 필요)은 커밋 `fcc7f52`까지의 git 기록에 남아 있습니다.
- **WinForms 버전**: `GoogleBrowser/` 폴더에 Windows 전용 WinForms + WebView2 버전이 그대로 남아 있습니다.
  Visual Studio에서 `GoogleBrowser.sln`을 열어 빌드할 수 있습니다(.NET Framework 4.6.2, WebView2 Runtime 필요).
