namespace MasterMap2
{
    partial class Form2
    {
        private System.ComponentModel.IContainer components = null;

        private System.Windows.Forms.TextBox textBoxUrl;
        private System.Windows.Forms.Button buttonGo;
        private System.Windows.Forms.Button buttonBack;
        private System.Windows.Forms.Button buttonForward;
        private System.Windows.Forms.Button buttonRefresh;
        private System.Windows.Forms.Button buttonHome;
        private Microsoft.Web.WebView2.WinForms.WebView2 webView21;
        private System.Windows.Forms.StatusStrip statusStrip1;
        private System.Windows.Forms.ToolStripStatusLabel toolStripStatusLabel1;
        private System.Windows.Forms.ToolStripProgressBar toolStripProgressBar1;
        private System.Windows.Forms.TrackBar trackBarOpacity;
        private System.Windows.Forms.Label labelOpacity;

        protected override void Dispose(bool disposing)
        {
            if (disposing && (components != null))
            {
                components.Dispose();
            }
            base.Dispose(disposing);
        }

        private void InitializeComponent()
        {
            this.textBoxUrl = new System.Windows.Forms.TextBox();
            this.buttonGo = new System.Windows.Forms.Button();
            this.buttonBack = new System.Windows.Forms.Button();
            this.buttonForward = new System.Windows.Forms.Button();
            this.buttonRefresh = new System.Windows.Forms.Button();
            this.buttonHome = new System.Windows.Forms.Button();
            this.webView21 = new Microsoft.Web.WebView2.WinForms.WebView2();
            this.statusStrip1 = new System.Windows.Forms.StatusStrip();
            this.toolStripStatusLabel1 = new System.Windows.Forms.ToolStripStatusLabel();
            this.toolStripProgressBar1 = new System.Windows.Forms.ToolStripProgressBar();
            this.trackBarOpacity = new System.Windows.Forms.TrackBar();
            this.labelOpacity = new System.Windows.Forms.Label();
            ((System.ComponentModel.ISupportInitialize)(this.webView21)).BeginInit();
            ((System.ComponentModel.ISupportInitialize)(this.trackBarOpacity)).BeginInit();
            this.statusStrip1.SuspendLayout();
            this.SuspendLayout();
            // 
            // textBoxUrl
            // 
            this.textBoxUrl.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left) 
            | System.Windows.Forms.AnchorStyles.Right)));
            this.textBoxUrl.Location = new System.Drawing.Point(210, 12);
            this.textBoxUrl.Name = "textBoxUrl";
            this.textBoxUrl.Size = new System.Drawing.Size(107, 19);
            this.textBoxUrl.TabIndex = 4;
            // 
            // buttonGo
            // 
            this.buttonGo.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Right)));
            this.buttonGo.Location = new System.Drawing.Point(327, 10);
            this.buttonGo.Name = "buttonGo";
            this.buttonGo.Size = new System.Drawing.Size(80, 28);
            this.buttonGo.TabIndex = 5;
            this.buttonGo.Text = "Go";
            this.buttonGo.Click += new System.EventHandler(this.buttonGo_Click);
            // 
            // buttonBack
            // 
            this.buttonBack.Enabled = false;
            this.buttonBack.Location = new System.Drawing.Point(10, 10);
            this.buttonBack.Name = "buttonBack";
            this.buttonBack.Size = new System.Drawing.Size(40, 28);
            this.buttonBack.TabIndex = 0;
            this.buttonBack.Text = "←";
            this.buttonBack.Click += new System.EventHandler(this.buttonBack_Click);
            // 
            // buttonForward
            // 
            this.buttonForward.Enabled = false;
            this.buttonForward.Location = new System.Drawing.Point(55, 10);
            this.buttonForward.Name = "buttonForward";
            this.buttonForward.Size = new System.Drawing.Size(40, 28);
            this.buttonForward.TabIndex = 1;
            this.buttonForward.Text = "→";
            this.buttonForward.Click += new System.EventHandler(this.buttonForward_Click);
            // 
            // buttonRefresh
            // 
            this.buttonRefresh.Location = new System.Drawing.Point(100, 10);
            this.buttonRefresh.Name = "buttonRefresh";
            this.buttonRefresh.Size = new System.Drawing.Size(40, 28);
            this.buttonRefresh.TabIndex = 2;
            this.buttonRefresh.Text = "⟳";
            this.buttonRefresh.Click += new System.EventHandler(this.buttonRefresh_Click);
            // 
            // buttonHome
            // 
            this.buttonHome.Location = new System.Drawing.Point(145, 10);
            this.buttonHome.Name = "buttonHome";
            this.buttonHome.Size = new System.Drawing.Size(60, 28);
            this.buttonHome.TabIndex = 3;
            this.buttonHome.Text = "Home";
            this.buttonHome.Click += new System.EventHandler(this.buttonHome_Click);
            // 
            // webView21
            // 
            this.webView21.AllowExternalDrop = true;
            this.webView21.Anchor = ((System.Windows.Forms.AnchorStyles)((((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Bottom) 
            | System.Windows.Forms.AnchorStyles.Left) 
            | System.Windows.Forms.AnchorStyles.Right)));
            this.webView21.CreationProperties = null;
            this.webView21.DefaultBackgroundColor = System.Drawing.Color.White;
            this.webView21.Location = new System.Drawing.Point(10, 45);
            this.webView21.Name = "webView21";
            this.webView21.Size = new System.Drawing.Size(397, 240);
            this.webView21.TabIndex = 6;
            this.webView21.ZoomFactor = 1D;
            // 
            // statusStrip1
            // 
            this.statusStrip1.Items.AddRange(new System.Windows.Forms.ToolStripItem[] {
            this.toolStripStatusLabel1,
            this.toolStripProgressBar1});
            this.statusStrip1.Location = new System.Drawing.Point(0, 324);
            this.statusStrip1.Name = "statusStrip1";
            this.statusStrip1.Size = new System.Drawing.Size(431, 22);
            this.statusStrip1.TabIndex = 7;
            // 
            // toolStripStatusLabel1
            // 
            this.toolStripStatusLabel1.Name = "toolStripStatusLabel1";
            this.toolStripStatusLabel1.Size = new System.Drawing.Size(314, 17);
            this.toolStripStatusLabel1.Spring = true;
            this.toolStripStatusLabel1.Text = "Ready";
            // 
            // toolStripProgressBar1
            // 
            this.toolStripProgressBar1.Name = "toolStripProgressBar1";
            this.toolStripProgressBar1.Size = new System.Drawing.Size(100, 16);
            //
            // labelOpacity
            //
            this.labelOpacity.Anchor = ((System.Windows.Forms.AnchorStyles)((System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left)));
            this.labelOpacity.AutoSize = true;
            this.labelOpacity.Location = new System.Drawing.Point(10, 296);
            this.labelOpacity.Name = "labelOpacity";
            this.labelOpacity.Size = new System.Drawing.Size(41, 12);
            this.labelOpacity.TabIndex = 8;
            this.labelOpacity.Text = "透明度";
            //
            // trackBarOpacity
            //
            this.trackBarOpacity.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Bottom | System.Windows.Forms.AnchorStyles.Left)
            | System.Windows.Forms.AnchorStyles.Right)));
            this.trackBarOpacity.AutoSize = false;
            this.trackBarOpacity.LargeChange = 10;
            this.trackBarOpacity.Location = new System.Drawing.Point(57, 290);
            this.trackBarOpacity.Maximum = 100;
            this.trackBarOpacity.Minimum = 10;
            this.trackBarOpacity.Name = "trackBarOpacity";
            this.trackBarOpacity.Size = new System.Drawing.Size(364, 28);
            this.trackBarOpacity.TabIndex = 9;
            this.trackBarOpacity.TickStyle = System.Windows.Forms.TickStyle.None;
            this.trackBarOpacity.Value = 19;
            //
            // Form2
            //
            this.AutoScaleDimensions = new System.Drawing.SizeF(6F, 12F);
            this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
            this.ClientSize = new System.Drawing.Size(431, 346);
            this.Controls.Add(this.buttonBack);
            this.Controls.Add(this.buttonForward);
            this.Controls.Add(this.buttonRefresh);
            this.Controls.Add(this.buttonHome);
            this.Controls.Add(this.textBoxUrl);
            this.Controls.Add(this.buttonGo);
            this.Controls.Add(this.labelOpacity);
            this.Controls.Add(this.trackBarOpacity);
            this.Controls.Add(this.webView21);
            this.Controls.Add(this.statusStrip1);
            this.Name = "Form2";
            this.Text = "";
            ((System.ComponentModel.ISupportInitialize)(this.webView21)).EndInit();
            ((System.ComponentModel.ISupportInitialize)(this.trackBarOpacity)).EndInit();
            this.statusStrip1.ResumeLayout(false);
            this.statusStrip1.PerformLayout();
            this.ResumeLayout(false);
            this.PerformLayout();

        }
    }
}
