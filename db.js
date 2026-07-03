const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

let dbInstance = null;
let dbPath = null;

function findWasmPath() {
  const candidates = [
    path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, 'sql-wasm.wasm'),
    path.join(process.cwd(), 'sql-wasm.wasm'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const exeDir = path.dirname(process.execPath);
  const exePath = path.join(exeDir, 'sql-wasm.wasm');
  if (exeDir !== __dirname && fs.existsSync(exePath)) return exePath;
  return null;
}

async function initDB(baseDir) {
  const wasmPath = findWasmPath();
  const SQL = await initSqlJs({
    locateFile: (file) => wasmPath || file
  });

  dbPath = path.join(baseDir, 'chat.db');

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    dbInstance = new SQL.Database(buffer);
  } else {
    dbInstance = new SQL.Database();
    saveNow();
  }

  // Always ensure schema exists (handles old databases missing new tables)
  dbInstance.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT DEFAULT '',
    text TEXT DEFAULT '',
    url TEXT DEFAULT '',
    time INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  dbInstance.run(`CREATE TABLE IF NOT EXISTS banned_users (
    id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    time INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  setInterval(saveNow, 5000);

  process.on('exit', saveNow);
  process.on('SIGINT', () => { saveNow(); process.exit(); });
  process.on('SIGTERM', () => { saveNow(); process.exit(); });

  return dbInstance;
}

function saveNow() {
  if (!dbInstance || !dbPath) return;
  try {
    const data = dbInstance.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (e) {
    console.error('[DB] save error:', e.message);
  }
}

function getDB() {
  return dbInstance;
}

function saveMessage(msg) {
  if (!dbInstance) return;
  dbInstance.run(
    'INSERT INTO messages (type, name, text, url, time) VALUES (?, ?, ?, ?, ?)',
    [msg.type, msg.name || '', msg.text || '', msg.url || '', msg.time || Date.now()]
  );
}

function getMessages(limit = 50) {
  if (!dbInstance) return [];
  const stmt = dbInstance.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?');
  stmt.bind([limit]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.reverse();
}

function clearMessages() {
  if (!dbInstance) return;
  dbInstance.run('DELETE FROM messages');
  dbInstance.run('VACUUM');
}

function clearUploads(uploadsDir) {
  if (!fs.existsSync(uploadsDir)) return;
  const files = fs.readdirSync(uploadsDir);
  for (const file of files) {
    const fp = path.join(uploadsDir, file);
    try { fs.unlinkSync(fp); } catch {}
  }
}

function getBannedList() {
  if (!dbInstance) return [];
  const stmt = dbInstance.prepare('SELECT * FROM banned_users ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function saveBan(id, name, ip) {
  if (!dbInstance) return;
  dbInstance.run('INSERT OR REPLACE INTO banned_users (id, name, ip, time) VALUES (?, ?, ?, ?)',
    [id, name || '', ip || '', Date.now()]);
}

function removeBan(id) {
  if (!dbInstance) return;
  dbInstance.run('DELETE FROM banned_users WHERE id = ?', [id]);
}

function clearBanned() {
  if (!dbInstance) return;
  dbInstance.run('DELETE FROM banned_users');
}

module.exports = { initDB, saveMessage, getMessages, clearMessages, clearUploads, getBannedList, saveBan, removeBan, clearBanned };
