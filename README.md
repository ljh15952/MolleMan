# MasterMap2

Windows용 **WebView2 기반 미니 브라우저**입니다. C# / .NET Framework WinForms로 작성되었으며, Microsoft Edge(크로미움) 엔진을 내장해 URL 탐색과 키보드 단축키로 마우스·스크롤을 제어합니다.

## 요구 사항

- Windows
- Visual Studio 2017 이상 (또는 MSBuild / NuGet CLI)
- .NET Framework 4.6.2
- Microsoft Edge WebView2 Runtime (최신 Windows에는 기본 포함)
- NuGet 패키지: `Microsoft.Web.WebView2` (빌드 시 자동 복원)

## 빌드 & 실행

Visual Studio:

1. `MasterMap2.sln`을 엽니다.
2. NuGet 패키지 복원(자동) 후 빌드합니다.
3. 실행합니다. 시작 페이지는 Bing입니다.

명령줄(MSBuild):

```bash
nuget restore MasterMap2.sln
msbuild MasterMap2.sln /p:Configuration=Release
```

## 사용법

- 주소창에 URL을 입력하고 Enter 또는 **Go** 버튼.
- **← → ⟳ Home** 버튼으로 탐색.

### 키보드 단축키

모든 페이지에 스크립트를 주입해 아래 키를 가로채고, Win32 `SendInput`으로 동작을 수행합니다.
(입력란 `input` / `textarea` / `contenteditable`에 포커스가 있을 때는 무시합니다.)

| 키 | 동작 |
|----|------|
| `Q` | 현재 커서 위치에서 좌클릭 |
| `W` | 뒤로 가기 |
| `A` | 위로 스크롤 |
| `S` | 아래로 스크롤 |

## 프로젝트 구조

| 파일 | 설명 |
|------|------|
| `Program.cs` | 진입점 (`Form2` 실행) |
| `Form2.cs` / `Form2.Designer.cs` | 메인 창 (WebView2 브라우저) |
| `MasterMap2.csproj` | 프로젝트 파일 |
| `App.config` | 런타임 설정 |

## 라이선스

프로젝트에 맞는 라이선스를 지정하세요.
