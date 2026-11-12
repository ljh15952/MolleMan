# echproxy — 로컬 ECH/DoH 프록시

WinForms + WebView2 버전이 **프록시 도메인(및 상류 사이트)의 실제 SNI를 TLS 핸드셰이크에서 암호화(ECH)** 하도록 해 주는 작은 로컬 프록시입니다.

## 왜 필요한가

관리(도메인 가입) 기기에서는 Chromium/Edge/WebView2가 **보안 DNS(DoH)를 정책으로 꺼 버리고, 명령줄 플래그로도 못 켭니다.** ECH는 DoH가 전제라, 결국 WebView2 자체로는 ECH를 쓸 수 없습니다.

그래서 **네트워크(이름 조회 + 상류 TLS)를 브라우저 대신 이 프록시가 수행**합니다. 브라우저는 루프백의 프록시하고만 TLS를 하므로(바깥으로 안 나감), 관리 정책의 DNS 통제를 받지 않습니다.

```
WebView2 ──TLS──▶ 127.0.0.1:8899 (echproxy) ──DoH 조회 + 상류 ECH 핸드셰이크──▶ 원본 서버
          루프백(SNI 안 샘)             여기서 실제 SNI가 암호화됨
```

## 동작

- **선택적 MITM**: `-ech-hosts`에 지정된 호스트(기본 `protect.ljh240310.date`)만 **로컬 CA 서명 인증서**로 TLS를 종단합니다(인증서는 메모리에만, 시스템 저장소 안 건드림). WinForms 앱은 이 인증서를 `ServerCertificateErrorDetected`로 수용합니다.
- **그 외 모든 호스트는 통과(passthrough)**: 브라우저가 직접 TLS를 하므로 정식 인증서·HSTS가 그대로 동작합니다(bing·naver 등 정상). MITM은 ECH를 발행하는 호스트에만 의미가 있고(그 외엔 상류로 어차피 평문 SNI가 나감), 괜히 MITM하면 HSTS 사이트만 깨지므로 통과가 맞습니다. 통과 시에도 이름은 DoH로 풀어 평문 DNS 조회를 피합니다.
- **DoH 조회**: 이름을 `1.1.1.1`(DoH, SNI `cloudflare-dns.com`)로 풀고, 해당 호스트의 `HTTPS` 레코드에서 `ech=` 설정을 가져옵니다. (부트스트랩은 IP로 직접 접속해 평문 DNS를 쓰지 않습니다.)
- **상류 ECH**: `ech=`가 있는 호스트는 `crypto/tls`의 `EncryptedClientHelloConfigList`로 ECH 핸드셰이크를 합니다(TLS 1.3). 없는 호스트는 일반 TLS로 그대로 중계합니다.
- 상류 서버 인증서는 프록시가 **정상 검증**합니다(브라우저가 프록시 인증서를 수용하는 것과 별개).

## 빌드

Go 1.24+ 필요(클라이언트 ECH). 이 저장소는 포터블 Go를 `.tools\go`에 두고 빌드합니다(시스템 PATH·레지스트리 변경 없음, `.gitignore` 처리됨).

```powershell
$root = "D:\イジュンハ\MasterMap2\.tools"
$env:GOROOT="$root\go"; $env:GOPATH="$root\gopath"; $env:GOCACHE="$root\gocache"; $env:GOTOOLCHAIN="local"
$env:Path="$env:GOROOT\bin;$env:Path"
Set-Location "D:\イジュンハ\MasterMap2\echproxy"
go build -o echproxy.exe .
```

빌드한 `echproxy.exe`를 **`GoogleBrowser.exe`와 같은 폴더**에 두면 됩니다(앱이 시작 시 자동 실행하고 종료 시 함께 끕니다). 이미 떠 있으면 재사용합니다.

## 단독 실행(디버깅)

```powershell
.\echproxy.exe -addr 127.0.0.1:8899
```

로그에 요청마다 다음이 찍힙니다:

```
upstream protect.ljh240310.date   echOffered=true  echAccepted=true  tls=0x304
```

`echAccepted=true` 면 그 연결의 실제 SNI가 암호화된 것입니다.

## 검증

- **프록시 로그**: Worker로 가는 요청에 `echAccepted=true`가 찍히면 그 연결의 실제 SNI가 암호화된 것입니다.
- **브라우저로 직접 확인**(선택): `tls-ech.dev`는 기본적으로 통과되므로, 아래처럼 MITM 대상에 넣고 실행한 뒤 네이티브 주소창에 `https://tls-ech.dev/`를 직접 열면 **"You are using ECH"**가 떠야 합니다.

  ```powershell
  .\echproxy.exe -addr 127.0.0.1:8899 -ech-hosts protect.ljh240310.date,tls-ech.dev
  ```

## 한계

- **회사망이 TLS 인스펙션(기업 루트 CA 중간자)을 하면** 상류 ECH가 무력화될 수 있습니다(방화벽이 TLS를 종단).
- ECH는 "어느 사이트냐(SNI)"만 가립니다. **목적지 IP(예: Cloudflare)는 그대로 노출**됩니다.
- 현재 브라우저↔프록시, 프록시↔상류 모두 HTTP/1.1로 중계합니다(단순화). 기능엔 문제없고 연결 수만 조금 많습니다.
- 회사 PC에서 회사 DNS/통제를 우회하는 것은 사내 규정 문제가 될 수 있습니다.
