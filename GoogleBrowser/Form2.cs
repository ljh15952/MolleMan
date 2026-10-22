using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace GoogleBrowser
{
    public partial class Form2 : Form
    {
        // ====== 옵션 ======
        // true: input/textarea/contenteditable에 커서가 있을 때는 Q/W/A/S 단축키를 무시(타이핑 방해 방지)
        // false: 입력 중이어도 단축키 동작
        private const bool IgnoreHotkeyWhileTyping = true;

        // WebView -> C# 메시지 접두사(충돌 방지)
        private const string HotkeyMsgPrefix = "MM2_HOTKEY:";

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        private const int INPUT_MOUSE = 0;
        private const int INPUT_KEYBOARD = 1;

        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;

        private const ushort VK_BACK = 0x08;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const int WHEEL_DELTA = 120;

        private string _pendingUrl;

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT
        {
            public uint type;
            public InputUnion U;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        public Form2()
        {
            InitializeComponent();

            this.KeyPreview = true; // 폼에도 키를 주고 싶으면 유지(하지만 WebView 포커스 문제는 JS로 해결)
            // 창 투명도: 기본 0.19, 하단 슬라이더로 조절
            this.Opacity = trackBarOpacity.Value / 100.0;
            trackBarOpacity.ValueChanged += TrackBarOpacity_ValueChanged;

            // WebView2 초기화는 Load에서
            this.Load += Form1_Load;

            textBoxUrl.KeyDown += TextBoxUrl_KeyDown;
        }

        // 하단 슬라이더로 창 투명도 조절 (10~100% → 0.10~1.00)
        private void TrackBarOpacity_ValueChanged(object sender, EventArgs e)
        {
            this.Opacity = trackBarOpacity.Value / 100.0;
        }

        private async void Form1_Load(object sender, EventArgs e)
        {
            try
            {
                await webView21.EnsureCoreWebView2Async();

                // ===== WebView2 이벤트 =====
                webView21.CoreWebView2.NavigationStarting += WebView_NavigationStarting;
                webView21.CoreWebView2.NavigationCompleted += WebView_NavigationCompleted;
                webView21.CoreWebView2.DocumentTitleChanged += WebView_DocumentTitleChanged;
                webView21.CoreWebView2.SourceChanged += WebView_SourceChanged;
                webView21.CoreWebView2.HistoryChanged += WebView_HistoryChanged;
                webView21.ZoomFactor = 0.85;
                
                // ===== 핵심: Web 안에서 키를 잡고 C#으로 전달 =====
                webView21.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;

                // 모든 문서 로드 시점에 스크립트 자동 주입
                // (페이지에 포커스가 있어도 Q/W/A/S를 안정적으로 감지)
                string ignoreTyping = IgnoreHotkeyWhileTyping ? "true" : "false";

                await webView21.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync($@"
(() => {{
  const IGNORE_TYPING = {ignoreTyping};

  window.addEventListener('keydown', (e) => {{
    const key = (e.key || '').toLowerCase();
    if (key !== 'q' && key !== 'w' && key !== 'a' && key !== 's') return;

    if (IGNORE_TYPING) {{
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return;
    }}

    try {{
      window.chrome.webview.postMessage('{HotkeyMsgPrefix}' + key);
    }} catch (_) {{}}

    e.preventDefault();
    e.stopPropagation();
  }}, true);
}})();
");

                // 초기 페이지(기동 전에 NavigateTo 호출됐으면 그걸 우선)
                if (!string.IsNullOrWhiteSpace(_pendingUrl))
                {
                    var tmp = _pendingUrl;
                    _pendingUrl = null;
                    NavigateTo(tmp);
                }
                else
                {
                    NavigateTo("https://www.bing.com/");
                }
            }
            catch (Exception ex)
            {
                toolStripStatusLabel1.Text = "WebView2初期化エラー: " + ex.Message;
            }
        }

        // Web -> C# 메시지 수신
        private void CoreWebView2_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg;

            try
            {
                msg = e.TryGetWebMessageAsString();
            }
            catch
            {
                // 문자열이 아닌 메시지가 들어오면 ArgumentException 등 발생 가능
                return;
            }
            if (string.IsNullOrEmpty(msg)) return;

            if (!msg.StartsWith(HotkeyMsgPrefix, StringComparison.Ordinal)) return;

            var key = msg.Substring(HotkeyMsgPrefix.Length);

            switch (key)
            {
                case "q":
                    ClickAtCursor();
                    break;
                case "w":
                    NavigateBack();
                    break;
                case "a":
                    SendMouseWheel(+WHEEL_DELTA * 2); // 위로
                    break;
                case "s":
                    SendMouseWheel(-WHEEL_DELTA * 5); // 아래로
                    break;
            }
        }

        private void SendMouseWheel(int delta)
        {
            var inputs = new INPUT[1];

            inputs[0].type = INPUT_MOUSE;
            inputs[0].U.mi.dwFlags = MOUSEEVENTF_WHEEL;
            inputs[0].U.mi.mouseData = unchecked((uint)delta); // 음수도 지원

            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        // 폼 쪽 단축키는 "보조"로만 유지(웹 포커스에서는 안 들어오는 경우가 있어 JS 방식이 본체)
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Q)
            {
                ClickAtCursor();
                return true;
            }

            if (keyData == Keys.W)
            {
                NavigateBack();
                return true;
            }

            if (keyData == Keys.A)
            {
                SendMouseWheel(+WHEEL_DELTA * 2);
                return true;
            }

            if (keyData == Keys.S)
            {
                SendMouseWheel(-WHEEL_DELTA * 8);
                return true;
            }

            return base.ProcessCmdKey(ref msg, keyData);
        }

        private void ClickAtCursor()
        {
            var inputs = new INPUT[2];

            inputs[0].type = INPUT_MOUSE;
            inputs[0].U.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;

            inputs[1].type = INPUT_MOUSE;
            inputs[1].U.mi.dwFlags = MOUSEEVENTF_LEFTUP;

            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        // W 키: 브라우저 뒤로 가기
        private void NavigateBack()
        {
            if (webView21 != null && webView21.CanGoBack)
                webView21.GoBack();
        }

        private void TextBoxUrl_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter)
            {
                e.SuppressKeyPress = true;
                NavigateTo(textBoxUrl.Text);
            }
        }

        private void buttonGo_Click(object sender, EventArgs e)
        {
            NavigateTo(textBoxUrl.Text);
        }

        private void buttonBack_Click(object sender, EventArgs e)
        {
            if (webView21 != null && webView21.CanGoBack) webView21.GoBack();
        }

        private void buttonForward_Click(object sender, EventArgs e)
        {
            if (webView21 != null && webView21.CanGoForward) webView21.GoForward();
        }

        private void buttonRefresh_Click(object sender, EventArgs e)
        {
            webView21?.Reload();
        }

        private void buttonHome_Click(object sender, EventArgs e)
        {
            NavigateTo("https://www.bing.com/");
        }

        private void NavigateTo(string input)
        {
            var url = (input ?? "").Trim();
            if (string.IsNullOrWhiteSpace(url)) return;

            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                url = "https://" + url;
            }

            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            {
                toolStripStatusLabel1.Text = "URLエラー: invalid url";
                return;
            }

            if (webView21?.CoreWebView2 == null)
            {
                _pendingUrl = uri.ToString();
                return;
            }

            try
            {
                webView21.Source = uri;
            }
            catch (Exception ex)
            {
                toolStripStatusLabel1.Text = "URLエラー: " + ex.Message;
            }
        }

        // ===== WebView2 이벤트 =====

        private void WebView_NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            toolStripStatusLabel1.Text = "読み込み中...";
            toolStripProgressBar1.Style = ProgressBarStyle.Marquee;

            UpdateNavButtons();
        }

        private async void WebView_NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            toolStripProgressBar1.Style = ProgressBarStyle.Blocks;
            toolStripProgressBar1.Value = 0;

            if (e.IsSuccess)
            {
                var title = webView21.CoreWebView2?.DocumentTitle;
                toolStripStatusLabel1.Text = string.IsNullOrWhiteSpace(title) ? "完了" : title;
                try
                {
                    await webView21.CoreWebView2.ExecuteScriptAsync(@"
(() => {
  const x = 170;               // ← 원하는 초기 X (px)
  const y = window.scrollY || 0;
  window.scrollTo(x, y);
})();
");
                }
                catch { /* ページによって失敗する場合は握りつぶし */ }
            }
            else
            {
                toolStripStatusLabel1.Text = $"エラー: {e.WebErrorStatus}";
            }

            // 포커스 보정(있으면 도움이 됨)
            webView21.Focus();

            UpdateNavButtons();
        }

        private void WebView_DocumentTitleChanged(object sender, object e)
        {
            var title = webView21.CoreWebView2?.DocumentTitle;
            if (!string.IsNullOrWhiteSpace(title))
                toolStripStatusLabel1.Text = title;
        }

        private void WebView_SourceChanged(object sender, CoreWebView2SourceChangedEventArgs e)
        {
            textBoxUrl.Text = webView21.Source?.ToString() ?? "";
        }

        private void WebView_HistoryChanged(object sender, object e)
        {
            UpdateNavButtons();
        }

        private void UpdateNavButtons()
        {
            buttonBack.Enabled = webView21 != null && webView21.CanGoBack;
            buttonForward.Enabled = webView21 != null && webView21.CanGoForward;
        }
    }
}
