# LAN Chat - 局域网聊天工具

轻量级局域网聊天工具，支持文字聊天、图片发送、用户管理。**无需互联网**，内网即可使用。

## 特色

- 🖥 **双端架构** — `Server.exe`（服务端）+ `Client.exe`（客户端），也支持浏览器直接访问
- 💬 **文字 + 图片** — 支持发送文字消息和图片（拖拽/选择文件上传）
- 🗄 **SQLite 存储** — 消息记录持久化，重启不丢失
- 👥 **在线用户管理** — 实时显示在线用户、IP 地址、禁言状态
- 🔨 **管理员功能** — 禁言、踢出、拉黑（右键菜单），黑名单双击解除
- 🚫 **拉黑自删除** — 被拉黑的客户端自动删除自身 exe
- 🖼 **纯内网运行** — 无需注册账号、无需云端服务器

## 使用方式

### 快速开始

1. 任意一台电脑运行 `Server.exe`
2. 局域网其他电脑打开浏览器访问 `http://服务器IP:3000`
3. 或者双击 `Client.exe` 输入服务器 IP 和昵称

### 打包

```bash
# 服务端（需要 Node.js）
npm install
.\build-sea.ps1    # 输出 dist/Server.exe + server-core.exe

# 客户端（Windows 自带 .NET）
csc /target:winexe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.dll /out:dist\Client.exe client.cs
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 服务端引擎 | Node.js 22 + SEA (Single Executable Application) |
| 服务端 GUI | C# WinForms (.NET Framework 4.8) |
| 客户端 | C# WinForms + WebBrowser |
| 前端 | HTML + CSS + ES5 JavaScript |
| 通信 | WebSocket (所有操作) + HTTP (图片上传) |
| 数据库 | SQLite (sql.js + WASM) |
