process.on('warning', (w) => {
  if (w.message && w.message.includes('single-executable')) return;
  console.warn(w.message);
});

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { initDB, saveMessage, getMessages, clearMessages, clearUploads, getBannedList, saveBan, removeBan, clearBanned } = require('./db');

const PORT = process.env.PORT || 3000;

const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : __dirname;
const uploadsDir = path.join(baseDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();
const mutedUsers = new Set();
const bannedUsers = new Map();
const serverLogs = [];

function addLog(level, source, ip, user, content) {
  const entry = { time: Date.now(), level, source, ip: ip || '', user: user || '', content: content || '' };
  serverLogs.push(entry);
  if (serverLogs.length > 2000) serverLogs.splice(0, 500);
  console.log('[' + level + '] [' + source + '] ' + (ip || '-') + ' ' + (user || '-') + ': ' + content);
  broadcast({ type: 'server_log', ...entry });
}

let dbReady = false;
initDB(baseDir).then(() => {
  dbReady = true;
  addLog('INFO', 'system', '', '', 'SQLite 数据库就绪');
  // Load banned list from DB
  try {
    const rows = getBannedList();
    for (const row of rows) {
      bannedUsers.set(row.id, { name: row.name || '', ip: row.ip || '', time: row.time || Date.now() });
    }
    if (rows.length > 0) addLog('INFO', 'system', '', '', '已加载 ' + rows.length + ' 条封禁记录');
  } catch (e) {
    addLog('WARN', 'system', '', '', '加载封禁记录失败: ' + e.message);
  }
}).catch((e) => {
  addLog('ERROR', 'system', '', '', '数据库初始化失败: ' + e.message);
});

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('仅允许图片文件'));
  }
});

const publicDir = path.join(baseDir, 'public');
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));
app.use(express.json());

app.get('/banned', (req, res) => {
  res.type('html').send('<!DOCTYPE html><meta charset="utf-8"><title>已被封禁</title><style>body{background:#1a1a2e;color:#e94560;display:flex;height:100vh;align-items:center;justify-content:center;font-family:Microsoft YaHei,sans-serif;font-size:24px}</style><div>你已被永久封禁</div>');
});

app.get('/kicked', (req, res) => {
  res.type('html').send('<!DOCTYPE html><meta charset="utf-8"><title>已被踢出</title><style>body{background:#1a1a2e;color:#e94560;display:flex;height:100vh;align-items:center;justify-content:center;font-family:Microsoft YaHei,sans-serif;font-size:24px}</style><div>你已被管理员踢出</div>');
});

app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未选择文件' });
  addLog('INFO', 'upload', req.ip || '-', '-', '上传图片: ' + req.file.filename);
  res.json({ url: '/uploads/' + req.file.filename });
});

app.get('/api/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(getMessages(limit));
});

app.delete('/api/messages', (req, res) => {
  clearMessages();
  addLog('WARN', 'admin', req.ip || '-', '-', '清空了所有消息记录');
  res.json({ ok: true });
});

app.delete('/api/uploads', (req, res) => {
  clearUploads(uploadsDir);
  addLog('WARN', 'admin', req.ip || '-', '-', '清空了所有图片文件');
  res.json({ ok: true });
});

app.delete('/api/all', (req, res) => {
  clearMessages();
  clearUploads(uploadsDir);
  bannedUsers.clear();
  mutedUsers.clear();
  clearBanned();
  addLog('WARN', 'admin', req.ip || '-', '-', '清除了所有数据');
  res.json({ ok: true, message: '所有数据已清除' });
});

app.get('/api/info', (req, res) => {
  const realOnline = Array.from(clients.values()).filter(c => !c.isAdmin).length;
  res.json({ ips: getLANIPs(), port: PORT, online: realOnline, muted: mutedUsers.size, banned: bannedUsers.size });
});

app.get('/api/users', (req, res) => {
  const list = [];
  for (const [ws, c] of clients) {
    list.push({ id: c.id, name: c.name, ip: c.ip, muted: mutedUsers.has(c.id) });
  }
  res.json(list);
});

app.post('/api/mute', (req, res) => {
  const id = req.body && req.body.userId;
  const mute = req.body && req.body.mute !== false;
  if (!id) return res.json({ ok: false });
  if (mute) mutedUsers.add(id); else mutedUsers.delete(id);
  const user = getUserById(id);
  addLog('WARN', 'admin', req.ip || '-', (user && user.name) || id, mute ? '禁言' : '解除禁言');
  broadcast({ type: 'users', users: getOnlineList() });
  if (mute && user) {
    for (const [ws, c] of clients) { if (c.id === id) ws.send(JSON.stringify({ type: 'system', content: '你已被管理员禁言' })); }
  }
  res.json({ ok: true });
});

app.post('/api/kick', (req, res) => {
  const id = req.body && req.body.userId;
  if (!id) return res.json({ ok: false });
  let found = false;
  for (const [ws, c] of clients) {
    if (c.id === id) {
      addLog('WARN', 'admin', req.ip || '-', c.name || id, '踢出');
      ws.close(4001, 'kicked');
      found = true;
      break;
    }
  }
  res.json({ ok: found });
});

app.post('/api/ban', (req, res) => {
  const id = req.body && req.body.userId;
  if (!id) return res.json({ ok: false });
  for (const [ws, c] of clients) {
    if (c.id === id) {
      bannedUsers.set(id, { name: c.name, ip: c.ip, time: Date.now() });
      saveBan(id, c.name, c.ip);
      addLog('WARN', 'admin', req.ip || '-', c.name || id, '拉黑 (IP: ' + (c.ip || '-') + ')');
      ws.close(4002, 'banned');
      broadcast({ type: 'system', content: c.name + ' 已被封禁' });
      broadcast({ type: 'users', users: getOnlineList() });
      return res.json({ ok: true });
    }
  }
  res.json({ ok: false, error: '用户不在线' });
});

app.get('/api/banned', (req, res) => {
  const list = [];
  for (const [id, info] of bannedUsers) {
    list.push({ id, name: info.name, ip: info.ip, time: info.time });
  }
  res.json(list);
});

app.post('/api/unban', (req, res) => {
  const id = req.body && req.body.userId;
  if (!id) return res.json({ ok: false });
  const info = bannedUsers.get(id);
  bannedUsers.delete(id);
  removeBan(id);
  addLog('WARN', 'admin', req.ip || '-', (info && info.name) || id, '解除拉黑');
  res.json({ ok: true });
});

app.post('/api/log', (req, res) => {
  const { level, message, source } = req.body || {};
  addLog(level || 'INFO', source || 'client', req.ip || '-', source || '-', message || '');
  res.json({ ok: true });
});

app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  res.json(serverLogs.slice(-limit));
});

function getLANIPs() {
  const list = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) list.push(iface.address);
    }
  }
  return list;
}

function getUserById(id) {
  for (const [, c] of clients) { if (c.id === id) return c; }
  return null;
}

function getOnlineList() {
  const list = [];
  for (const [ws, c] of clients) {
    if (c.isAdmin) continue;
    list.push({ id: c.id, name: c.name, ip: c.ip, muted: mutedUsers.has(c.id) });
  }
  return list;
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const [ws] of clients) {
    if (ws.readyState === 1) {
      try { ws.send(msg); } catch (e) { clients.delete(ws); }
    }
  }
}

wss.on('connection', (ws, req) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';
  const id = Math.random().toString(36).slice(2, 8);

  // Check if IP is banned
  for (const [, info] of bannedUsers) {
    if (info.ip === clientIP) {
      addLog('WARN', 'system', clientIP, info.name || '?', '被拉黑用户尝试连接，已拒绝');
      ws.close(4002, 'banned');
      return;
    }
  }

  const client = { id, name: 'Anonymous', ip: clientIP };
  clients.set(ws, client);

  addLog('INFO', 'system', clientIP, id, '已连接');
  ws.send(JSON.stringify({ type: 'users', users: getOnlineList() }));
  if (dbReady) {
    const history = getMessages(50);
    ws.send(JSON.stringify({ type: 'history', messages: history }));
  }

  function sendResult(ok, message) {
    ws.send(JSON.stringify({ type: 'result', ok, message }));
  }

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    switch (data.type) {
      case 'join': {
        client.name = data.name || 'Anonymous';
        client.isAdmin = client.name.startsWith('[');
        if (client.isAdmin) {
          ws.send(JSON.stringify({ type: 'users', users: getOnlineList() }));
          break;
        }
        addLog('INFO', 'system', clientIP, client.name, '加入了聊天');
        broadcast({ type: 'system', content: client.name + ' 加入了聊天', time: Date.now() });
        broadcast({ type: 'users', users: getOnlineList() });
        break;
      }
      case 'text': {
        if (!data.text || !data.text.trim()) return;
        if (mutedUsers.has(client.id)) {
          ws.send(JSON.stringify({ type: 'system', content: '你已被禁言，无法发送消息' }));
          return;
        }
        const msg = { type: 'text', name: client.name, text: data.text.trim(), time: Date.now() };
        saveMessage(msg);
        broadcast(msg);
        break;
      }
      case 'image': {
        if (!data.url) return;
        if (mutedUsers.has(client.id)) {
          ws.send(JSON.stringify({ type: 'system', content: '你已被禁言，无法发送图片' }));
          return;
        }
        const msg = { type: 'image', name: client.name, url: data.url, text: data.text || '', time: Date.now() };
        saveMessage(msg);
        broadcast(msg);
        break;
      }
      case 'log': {
        if (data.message) {
          addLog(data.level || 'INFO', data.source || 'client', clientIP, client.name || '-', data.message);
        }
        break;
      }
      case 'get_info': {
        const realOnline = Array.from(clients.values()).filter(c => !c.isAdmin).length;
        ws.send(JSON.stringify({ type: 'info', ips: getLANIPs(), port: PORT, online: realOnline, muted: mutedUsers.size, banned: bannedUsers.size }));
        break;
      }
      case 'get_users': {
        ws.send(JSON.stringify({ type: 'users', users: getOnlineList() }));
        break;
      }
      case 'get_banned': {
        const list = [];
        for (const [id, info] of bannedUsers) list.push({ id, name: info.name, ip: info.ip, time: info.time });
        ws.send(JSON.stringify({ type: 'banned', list }));
        break;
      }
      case 'mute': {
        const id = data.userId; const mute = data.mute !== false;
        if (!id) return sendResult(false, '缺少 userId');
        if (mute) mutedUsers.add(id); else mutedUsers.delete(id);
        const u = getUserById(id);
        addLog('WARN', 'admin', clientIP, (u && u.name) || id, mute ? '禁言' : '解除禁言');
        broadcast({ type: 'users', users: getOnlineList() });
        if (mute && u) {
          for (const [w, c] of clients) { if (c.id === id) w.send(JSON.stringify({ type: 'system', content: '你已被管理员禁言' })); }
        }
        sendResult(true, mute ? '已禁言' : '已解除禁言');
        break;
      }
      case 'kick': {
        const kid = data.userId;
        if (!kid) return sendResult(false, '缺少 userId');
        for (const [w, c] of clients) {
          if (c.id === kid) {
            addLog('WARN', 'admin', clientIP, c.name || kid, '踢出');
            w.close(4001, 'kicked');
            return sendResult(true, '已踢出');
          }
        }
        sendResult(false, '用户不在线');
        break;
      }
      case 'ban': {
        const bid = data.userId;
        if (!bid) return sendResult(false, '缺少 userId');
        for (const [w, c] of clients) {
          if (c.id === bid) {
            bannedUsers.set(bid, { name: c.name, ip: c.ip, time: Date.now() });
            saveBan(bid, c.name, c.ip);
            addLog('WARN', 'admin', clientIP, c.name || bid, '拉黑 (IP: ' + (c.ip || '-') + ')');
            w.close(4002, 'banned');
            broadcast({ type: 'system', content: c.name + ' 已被封禁' });
            broadcast({ type: 'users', users: getOnlineList() });
            return sendResult(true, '已拉黑');
          }
        }
        sendResult(false, '用户不在线');
        break;
      }
      case 'unban': {
        const uid = data.userId;
        if (!uid) return sendResult(false, '缺少 userId');
        const info = bannedUsers.get(uid);
        bannedUsers.delete(uid);
        removeBan(uid);
        addLog('WARN', 'admin', clientIP, (info && info.name) || uid, '解除拉黑');
        sendResult(true, '已解除拉黑');
        break;
      }
      case 'clear_msgs': {
        clearMessages();
        addLog('WARN', 'admin', clientIP, client.name, '清空了所有消息记录');
        sendResult(true, '消息已清空');
        break;
      }
      case 'clear_all': {
        clearMessages();
        clearUploads(uploadsDir);
        bannedUsers.clear();
        mutedUsers.clear();
        clearBanned();
        addLog('WARN', 'admin', clientIP, client.name, '清除了所有数据');
        sendResult(true, '所有数据已清除');
        broadcast({ type: 'banned', list: [] });
        broadcast({ type: 'users', users: getOnlineList() });
        break;
      }
    }
  });

  ws.on('close', (code) => {
    const name = client.name;
    clients.delete(ws);
    if (code === 4002) {
      addLog('WARN', 'system', clientIP, name, '被拉黑断开');
    } else if (code === 4001) {
      addLog('WARN', 'system', clientIP, name, '被踢出');
      broadcast({ type: 'system', content: name + ' 被管理员踢出', time: Date.now() });
    } else {
      addLog('INFO', 'system', clientIP, name, '离开了聊天');
      broadcast({ type: 'system', content: name + ' 离开了聊天', time: Date.now() });
    }
    broadcast({ type: 'users', users: getOnlineList() });
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLANIPs();
  addLog('INFO', 'system', '', '', '服务器启动 - 端口 ' + PORT);
  console.log('');
  for (const ip of ips) {
    console.log('   http://' + ip + ':' + PORT);
  }
  console.log('');
  console.log('[DB] SQLite ready');
});
