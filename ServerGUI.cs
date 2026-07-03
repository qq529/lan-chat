using System;
using System.Collections;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ServerForm());
    }
}

class ServerForm : Form
{
    private Process serverProcess;
    private ListView userView, banView;
    private Label statusLabel;
    private ClientWebSocket adminWs;
    private bool wsConnected;
    private bool wsConnecting;
    private System.Windows.Forms.Timer wsReconnectTimer;
    private System.Windows.Forms.Timer refreshTimer;

    public ServerForm()
    {
        Text = "LAN Chat 服务器";
        Size = new Size(680, 500);
        MinimumSize = new Size(500, 400);
        StartPosition = FormStartPosition.CenterScreen;

        var topBar = new Panel { Height = 60, Dock = DockStyle.Top, BackColor = Color.FromArgb(22, 33, 62) };
        var title = new Label { Text = "LAN Chat 服务器", ForeColor = Color.FromArgb(233, 69, 60), Left = 12, Top = 10, Width = 200, Font = new Font("Microsoft YaHei", 14, FontStyle.Bold) };
        statusLabel = new Label { Text = "启动中...", ForeColor = Color.Gray, Left = 12, Top = 36, Width = 500, Font = new Font("Microsoft YaHei", 10) };
        var logBtn = new Button { Text = "日志", Left = 580, Top = 18, Width = 60, Height = 28, FlatStyle = FlatStyle.Flat };
        logBtn.Click += (s, e) => ShowLogs();
        topBar.Controls.Add(title);
        topBar.Controls.Add(statusLabel);
        topBar.Controls.Add(logBtn);
        Controls.Add(topBar);

        var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 280 };
        BuildUserPanel(split.Panel1);
        BuildBanPanel(split.Panel2);
        Controls.Add(split);

        Shown += (s, e) => StartServer();
        FormClosing += (s, e) =>
        {
            if (wsReconnectTimer != null) wsReconnectTimer.Stop();
            if (refreshTimer != null) refreshTimer.Stop();
            DisconnectWs();
            if (serverProcess != null && !serverProcess.HasExited)
            { serverProcess.Kill(); serverProcess.WaitForExit(3000); }
        };
    }

    void BuildUserPanel(Panel parent)
    {
        parent.Controls.Add(new Label { Text = "在线用户（右键操作）", Dock = DockStyle.Top, Height = 24, TextAlign = ContentAlignment.MiddleLeft });
        userView = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, MultiSelect = false };
        userView.Columns.Add("序号", 40);
        userView.Columns.Add("用户", 120);
        userView.Columns.Add("IP地址", 150);
        userView.Columns.Add("状态", 80);
        var menu = new ContextMenuStrip();
        menu.Items.Add("禁言/解除禁言", null, (s, e) => WsSend("{\"type\":\"mute\",\"userId\":\"" + SelUserId() + "\",\"mute\":" + (IsMuted() ? "false" : "true") + "}"));
        menu.Items.Add("踢出", null, (s, e) => { if (Confirm("确定踢出？")) WsSend("{\"type\":\"kick\",\"userId\":\"" + SelUserId() + "\"}"); });
        menu.Items.Add("拉黑", null, (s, e) => { if (Confirm("确定拉黑？")) WsSend("{\"type\":\"ban\",\"userId\":\"" + SelUserId() + "\"}"); });
        userView.ContextMenuStrip = menu;
        parent.Controls.Add(userView);
    }

    void BuildBanPanel(Panel parent)
    {
        parent.Controls.Add(new Label { Text = "黑名单（双击解除）", Dock = DockStyle.Top, Height = 24, TextAlign = ContentAlignment.MiddleLeft });
        var clearBtn = new Button { Text = "清除所有数据", Location = new Point(10, 2), Size = new Size(140, 28), BackColor = Color.FromArgb(233, 69, 96), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
        clearBtn.Click += (s, e) => { if (Confirm("确定清除所有数据？")) WsSend("{\"type\":\"clear_all\"}"); };
        var banTop = new Panel { Height = 32, Dock = DockStyle.Top };
        banTop.Controls.Add(clearBtn);
        parent.Controls.Add(banTop);
        banView = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true };
        banView.Columns.Add("用户", 100);
        banView.Columns.Add("ID", 80);
        banView.Columns.Add("IP", 150);
        banView.Columns.Add("时间", 150);
        banView.DoubleClick += (s, e) => { if (banView.SelectedItems.Count > 0 && Confirm("解除拉黑？")) { var id = banView.SelectedItems[0].Tag as string; WsSend("{\"type\":\"unban\",\"userId\":\"" + id + "\"}"); } };
        parent.Controls.Add(banView);
    }

    string SelUserId() { return userView.SelectedItems.Count > 0 ? (userView.SelectedItems[0].Tag as string) : ""; }
    bool IsMuted() { return userView.SelectedItems.Count > 0 && userView.SelectedItems[0].SubItems[3].Text == "已禁言"; }
    bool Confirm(string m) { return MessageBox.Show(m, "确认", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes; }

    void WsSend(string json)
    {
        var ws = adminWs;
        if (ws == null || ws.State != WebSocketState.Open) return;
        var data = Encoding.UTF8.GetBytes(json);
        Task.Run(async () => {
            try { await ws.SendAsync(new ArraySegment<byte>(data), WebSocketMessageType.Text, true, CancellationToken.None); }
            catch { }
        });
    }

    void StartServer()
    {
        string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
        string coreExe = Path.Combine(exeDir, "server-core.exe");
        if (!File.Exists(coreExe)) { statusLabel.Text = "错误: 缺少 server-core.exe"; return; }

        serverProcess = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = coreExe, UseShellExecute = false, CreateNoWindow = true
            }
        };
        serverProcess.Start();
        statusLabel.Text = "启动中...";
        ConnectWs();
        wsReconnectTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        wsReconnectTimer.Tick += (s, e) => { if (!wsConnected && !wsConnecting) ConnectWs(); };
        wsReconnectTimer.Start();

        refreshTimer = new System.Windows.Forms.Timer { Interval = 3000 };
        refreshTimer.Tick += (s, e) => {
          if (!wsConnected) return;
          WsSend("{\"type\":\"get_info\"}");
          WsSend("{\"type\":\"get_users\"}");
          WsSend("{\"type\":\"get_banned\"}");
        };
        refreshTimer.Start();
    }

    void ConnectWs()
    {
        if (wsConnecting) return;
        wsConnecting = true;

        // Properly close old WS before creating new one
        if (adminWs != null)
        {
            try
            {
                if (adminWs.State == WebSocketState.Open || adminWs.State == WebSocketState.CloseReceived)
                {
                    var task = adminWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "reconnect", CancellationToken.None);
                    task.Wait(2000);
                }
            }
            catch { }
            try { adminWs.Dispose(); } catch { }
            adminWs = null;
        }

        Task.Run(async () =>
        {
            try
            {
                var ws = new ClientWebSocket();
                await ws.ConnectAsync(new Uri("ws://127.0.0.1:3000"), CancellationToken.None);

                var join = Encoding.UTF8.GetBytes("{\"type\":\"join\",\"name\":\"[ServerGUI]\"}");
                await ws.SendAsync(new ArraySegment<byte>(join), WebSocketMessageType.Text, true, CancellationToken.None);

                adminWs = ws;
                wsConnected = true;
                wsConnecting = false;

                var buf = new byte[65536];
                while (ws.State == WebSocketState.Open)
                {
                    var seg = new ArraySegment<byte>(buf);
                    var result = await ws.ReceiveAsync(seg, CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Text)
                    {
                        var json = Encoding.UTF8.GetString(buf, 0, result.Count);
                        HandleWsMsg(json);
                    }
                    else if (result.MessageType == WebSocketMessageType.Close)
                    {
                        try { await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None); } catch { }
                        break;
                    }
                }
            }
            catch { }
            wsConnected = false;
            wsConnecting = false;
            if (adminWs != null) { try { adminWs.Dispose(); } catch { } adminWs = null; }
        });
    }

    void DisconnectWs()
    {
        try { if (adminWs != null) { if (adminWs.State == WebSocketState.Open) adminWs.CloseAsync(WebSocketCloseStatus.NormalClosure, "close", CancellationToken.None).Wait(1000); adminWs.Dispose(); } } catch { }
    }

    void HandleWsMsg(string json)
    {
        var obj = FastJson.Parse(json);
        var type = obj["type"] as string;
        if (type == null) return;

        switch (type)
        {
            case "users":
                BeginInvoke(new Action<Hashtable>(OnUsers), obj);
                break;
            case "info":
                BeginInvoke(new Action<Hashtable>(OnInfo), obj);
                break;
            case "banned":
                BeginInvoke(new Action<Hashtable>(OnBanned), obj);
                break;
            case "result":
                var ok = obj["ok"] as string;
                var msg = obj["message"] as string ?? "";
                BeginInvoke(new Action(() => { MessageBox.Show(msg, ok == "true" ? "成功" : "失败", MessageBoxButtons.OK, ok == "true" ? MessageBoxIcon.Information : MessageBoxIcon.Warning); }));
                break;
        }
    }

    void OnUsers(Hashtable obj)
    {
        var users = obj["users"] as ArrayList;
        if (users == null) return;
        userView.Items.Clear();
        for (int i = 0; i < users.Count; i++)
        {
            var u = users[i] as Hashtable;
            if (u == null) continue;
            var idx = (i + 1).ToString();
            var item = new ListViewItem(new[] { idx, u["name"] as string ?? "?", u["ip"] as string ?? "", (u["muted"] as string == "true") ? "已禁言" : "" });
            item.Tag = u["id"];
            userView.Items.Add(item);
        }
    }

    void OnInfo(Hashtable obj)
    {
        var ipList = obj["ips"] as ArrayList;
        var ips = (ipList != null && ipList.Count > 0) ? ipList[0] : "-";
        statusLabel.Text = ips + ":" + obj["port"] + "  在线:" + obj["online"] + "  禁言:" + obj["muted"] + "  拉黑:" + obj["banned"];
    }

    void OnBanned(Hashtable obj)
    {
        var list = obj["list"] as ArrayList;
        if (list == null) return;
        banView.Items.Clear();
        for (int i = 0; i < list.Count; i++)
        {
            var b = list[i] as Hashtable;
            if (b == null) continue;
            var t = "";
            try { var ts = double.Parse(b["time"] as string ?? "0"); t = new DateTime(1970, 1, 1).AddMilliseconds(ts).ToString("HH:mm:ss"); } catch { }
            var item = new ListViewItem(new[] { b["name"] as string ?? "?", b["id"] as string ?? "", b["ip"] as string ?? "", t });
            item.Tag = b["id"];
            banView.Items.Add(item);
        }
    }

    void ShowLogs()
    {
        var form = new Form { Text = "服务器日志", Size = new Size(800, 500), StartPosition = FormStartPosition.CenterParent };
        var lv = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, Font = new Font("Consolas", 10), BackColor = Color.FromArgb(30, 30, 30), ForeColor = Color.FromArgb(0, 255, 0) };
        lv.Columns.Add("时间", 70);
        lv.Columns.Add("等级", 50);
        lv.Columns.Add("来源", 80);
        lv.Columns.Add("IP", 130);
        lv.Columns.Add("用户", 100);
        lv.Columns.Add("内容", 350);
        var refreshBtn = new Button { Text = "刷新", Dock = DockStyle.Bottom, Height = 28, FlatStyle = FlatStyle.Flat };

        refreshBtn.Click += (s, e) =>
        {
            try
            {
                var req = WebRequest.CreateHttp("http://127.0.0.1:3000/api/logs?limit=200");
                req.Timeout = 3000;
                using (var r = new StreamReader(req.GetResponse().GetResponseStream()))
                {
                    var arr = FastJson.ParseArray(r.ReadToEnd());
                    lv.BeginUpdate();
                    lv.Items.Clear();
                    for (int i = 0; i < arr.Count; i++)
                    {
                        var o = arr[i] as Hashtable;
                        if (o == null) continue;
                        var t = "";
                        try { var ts = (double)(o["time"] ?? 0); t = new DateTime(1970, 1, 1).AddMilliseconds(ts).ToString("HH:mm:ss"); } catch { }
                        var item = new ListViewItem(new[] { t, o["level"] as string ?? "", o["source"] as string ?? "", o["ip"] as string ?? "", o["user"] as string ?? "", o["content"] as string ?? "" });
                        if ((o["level"] as string) == "WARN" || (o["level"] as string) == "ERROR") item.BackColor = Color.FromArgb(80, 30, 30);
                        lv.Items.Add(item);
                    }
                    lv.EndUpdate();
                }
            }
            catch (Exception ex) { MessageBox.Show("获取日志失败: " + ex.Message); }
        };

        form.Controls.Add(lv);
        form.Controls.Add(refreshBtn);
        refreshBtn.PerformClick();
        form.ShowDialog();
    }
}

static class FastJson
{
    public static ArrayList ParseArray(string json) { var r = new ArrayList(); json = json.Trim(); if (!json.StartsWith("[") || json.Length < 2) return r; json = json.Substring(1, json.Length - 2); int i = 0; while (i < json.Length) { SkipWS(json, ref i); if (i >= json.Length) break; r.Add(ReadVal(json, ref i)); SkipWS(json, ref i); if (i < json.Length && json[i] == ',') i++; } return r; }
    public static Hashtable Parse(string json) { var r = new Hashtable(); json = json.Trim(); if (!json.StartsWith("{") || json.Length < 2) return r; json = json.Substring(1, json.Length - 2); int i = 0; while (i < json.Length) { SkipWS(json, ref i); if (i >= json.Length) break; string k = ReadStr(json, ref i); SkipWS(json, ref i); if (i < json.Length && json[i] == ':') i++; SkipWS(json, ref i); r[k] = ReadVal(json, ref i); SkipWS(json, ref i); if (i < json.Length && json[i] == ',') i++; } return r; }
    static void SkipWS(string s, ref int i) { while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++; }
    static string ReadStr(string s, ref int i) { if (s[i] != '"') return ""; i++; var sb = new StringBuilder(); while (i < s.Length && s[i] != '"') { if (s[i] == '\\') { i++; if (i < s.Length) { sb.Append(s[i]); i++; } } else { sb.Append(s[i]); i++; } } if (i < s.Length) i++; return sb.ToString(); }
    static object ReadVal(string s, ref int i) { if (i >= s.Length) return null; if (s[i] == '"') return ReadStr(s, ref i); if (s[i] == '{') { i++; var o = new Hashtable(); while (i < s.Length && s[i] != '}') { SkipWS(s, ref i); if (i < s.Length && s[i] == '}') break; string k = ReadStr(s, ref i); SkipWS(s, ref i); if (i < s.Length && s[i] == ':') i++; SkipWS(s, ref i); o[k] = ReadVal(s, ref i); SkipWS(s, ref i); if (i < s.Length && s[i] == ',') i++; } if (i < s.Length) i++; return o; } if (s[i] == '[') { i++; var l = new ArrayList(); while (i < s.Length && s[i] != ']') { SkipWS(s, ref i); if (i < s.Length && s[i] == ']') break; l.Add(ReadVal(s, ref i)); SkipWS(s, ref i); if (i < s.Length && s[i] == ',') i++; } if (i < s.Length) i++; return l; } var sb = new StringBuilder(); while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '.')) { sb.Append(s[i]); i++; } if (sb.Length > 0) return sb.ToString(); if (i + 4 <= s.Length && s.Substring(i, 4) == "true") { i += 4; return "true"; } if (i + 5 <= s.Length && s.Substring(i, 5) == "false") { i += 5; return "false"; } if (i + 4 <= s.Length && s.Substring(i, 4) == "null") { i += 4; return null; } return null; }
}
