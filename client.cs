using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        using (var dlg = new ConnectDialog())
        {
            if (dlg.ShowDialog() != DialogResult.OK) return;
            string url = "http://" + dlg.Ip + ":" + dlg.Port + "/?name=" + Uri.EscapeDataString(dlg.Nickname);
            try { Application.Run(new ChatForm(url)); }
            catch (Exception ex) { MessageBox.Show("启动失败: " + ex.Message, "错误", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }
    }
}

class ChatForm : Form
{
    private WebBrowser browser;
    private string startUrl;

    public ChatForm(string url)
    {
        startUrl = url;
        Text = "LAN Chat";
        Size = new Size(480, 360);
        MinimumSize = new Size(300, 200);
        StartPosition = FormStartPosition.CenterScreen;

        var statusBar = new Label
        {
            Text = startUrl,
            Dock = DockStyle.Bottom,
            Height = 22,
            ForeColor = Color.Gray,
            BackColor = Color.FromArgb(22, 33, 62),
            Font = new Font("Microsoft YaHei", 9),
            Padding = new Padding(8, 2, 0, 0)
        };

        browser = new WebBrowser
        {
            Dock = DockStyle.Fill,
            ScriptErrorsSuppressed = true,
            AllowWebBrowserDrop = false,
            IsWebBrowserContextMenuEnabled = false
        };

        browser.Navigated += OnNavigated;
        Controls.Add(browser);
        Controls.Add(statusBar);

        Shown += (s, e) =>
        {
            ForceIE11();
            browser.Navigate(startUrl);
        };
    }

    private void OnNavigated(object sender, WebBrowserNavigatedEventArgs e)
    {
        string path = e.Url.AbsolutePath.ToLower();
        if (path == "/banned")
        {
            SelfDelete();
        }
    }

    private void SelfDelete()
    {
        try
        {
            string exePath = Application.ExecutablePath;
            string batPath = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "del_" + Guid.NewGuid().ToString("N") + ".bat"
            );

            System.IO.File.WriteAllText(batPath,
                "@echo off\r\n" +
                "timeout /t 2 /nobreak >nul\r\n" +
                "del /f /q \"" + exePath + "\"\r\n" +
                "del /f /q \"" + batPath + "\"\r\n"
            );

            Process.Start(new ProcessStartInfo
            {
                FileName = batPath,
                WindowStyle = ProcessWindowStyle.Hidden,
                CreateNoWindow = true,
                UseShellExecute = true
            });

            MessageBox.Show("你已被管理员封禁", "封禁通知", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            Application.Exit();
        }
        catch
        {
            MessageBox.Show("你已被管理员封禁\n客户端即将退出", "封禁通知", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            Application.Exit();
        }
    }

    private void ForceIE11()
    {
        try
        {
            string app = AppDomain.CurrentDomain.FriendlyName;
            using (var rk = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Internet Explorer\Main\FeatureControl\FEATURE_BROWSER_EMULATION"))
            {
                if (rk != null) rk.SetValue(app, 11001, RegistryValueKind.DWord);
            }
        }
        catch { }
    }
}

class ConnectDialog : Form
{
    public string Ip { get; private set; }
    public string Port { get; private set; }
    public string Nickname { get; private set; }

    private TextBox txtIp, txtPort, txtName;

    public ConnectDialog()
    {
        Text = "LAN Chat - 连接";
        ClientSize = new Size(400, 260);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var lblIp = new Label { Text = "服务器地址", Location = new Point(30, 25), Size = new Size(340, 20) };
        txtIp = new TextBox { Location = new Point(30, 45), Size = new Size(340, 24), Text = "192.168.1.3" };
        var lblPort = new Label { Text = "端口", Location = new Point(30, 78), Size = new Size(340, 20) };
        txtPort = new TextBox { Location = new Point(30, 98), Size = new Size(340, 24), Text = "3000" };
        var lblName = new Label { Text = "昵称", Location = new Point(30, 131), Size = new Size(340, 20) };
        txtName = new TextBox { Location = new Point(30, 151), Size = new Size(340, 24) };

        var btn = new Button { Text = "连接到聊天室", Location = new Point(30, 190), Size = new Size(340, 35), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(233, 69, 96), ForeColor = Color.White };
        btn.Click += (s, e) => Connect();
        AcceptButton = btn;
        Controls.AddRange(new Control[] { lblIp, txtIp, lblPort, txtPort, lblName, txtName, btn });
        txtName.Focus();
    }

    private void Connect()
    {
        string ip = txtIp.Text.Trim();
        string port = txtPort.Text.Trim();
        string name = txtName.Text.Trim();
        if (ip == "" || port == "" || name == "")
        { MessageBox.Show("请填写所有字段", "提示", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
        Ip = ip; Port = port; Nickname = name;
        DialogResult = DialogResult.OK;
        Close();
    }
}
