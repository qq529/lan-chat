var wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
var wsUrl = wsProtocol + '://' + location.host;

var ws = null;
var myName = '';
var connected = false;

function $(s) { return document.querySelector(s); }
var messagesEl = $('#messages');
var inputText = $('#input-text');
var btnSend = $('#btn-send');
var inputName = $('#input-name');
var btnJoin = $('#btn-join');
var loginPanel = $('#login-panel');
var chatPanel = $('#chat-panel');
var usersList = $('#users-list');
var userCount = $('#user-count');
var serverInfo = $('#server-info');
var inputImage = $('#input-image');
var btnImage = $('#btn-image');
var btnClearMsgs = $('#btn-clear-msgs');
var btnClearAll = $('#btn-clear-all');

function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = function() {
    connected = true;
    if (myName) {
      ws.send(JSON.stringify({ type: 'join', name: myName }));
      loginPanel.classList.add('hidden');
      chatPanel.classList.remove('hidden');
    }
  };

  ws.onmessage = function(e) {
    var data;
    try { data = JSON.parse(e.data); } catch (_) { return; }
    handleMessage(data);
  };

  ws.onclose = function(e) {
    connected = false;
    if (e && e.code === 4002) { location.href = '/banned'; return; }
    if (e && e.code === 4001) { location.href = '/kicked'; return; }
    if (myName) {
      addSystemMsg('与服务器断开连接，正在重连...');
      setTimeout(connect, 3000);
    }
  };

  ws.onerror = function() {
    if (!myName) {
      addSystemMsg('无法连接到服务器');
    }
  };
}

function handleMessage(data) {
  switch (data.type) {
    case 'history':
      renderHistory(data.messages);
      break;
    case 'text':
      renderMessage(data, data.name === myName ? 'self' : 'other');
      break;
    case 'image':
      renderImageMsg(data, data.name === myName ? 'self' : 'other');
      break;
    case 'system':
      addSystemMsg(data.content);
      break;
    case 'users':
      renderUsers(data.users);
      break;
  }
}

function join() {
  var name = inputName.value.trim();
  if (!name) return showToast('请输入昵称');
  myName = name;
  ws.send(JSON.stringify({ type: 'join', name: name }));
  loginPanel.classList.add('hidden');
  chatPanel.classList.remove('hidden');
  inputText.focus();
}

function sendText() {
  var text = inputText.value.trim();
  if (!text || !connected) return;
  ws.send(JSON.stringify({ type: 'text', text: text }));
  inputText.value = '';
  inputText.focus();
}

function wsLog(level, message) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'log', level: level, message: message, source: myName || 'web' }));
  } else {
    xhrSend('POST', '/api/log', JSON.stringify({ level: level, message: message, source: myName || 'web' }), function(){});
  }
}

function xhrSend(method, url, body, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, url, true);
  xhr.onload = function() {
    try { callback(null, JSON.parse(xhr.responseText)); }
    catch (e) { callback(e); }
  };
  xhr.onerror = function() { callback(new Error('请求失败')); };
  if (typeof body === 'string') { xhr.setRequestHeader('Content-Type', 'application/json'); xhr.send(body); }
  else if (body) { xhr.send(body); }
  else { xhr.send(); }
}

function sendImage(file) {
  if (!connected) return showToast('未连接');
  var formData = new FormData();
  formData.append('image', file);
  showToast('上传中...');
  xhrSend('POST', '/upload', formData, function(err, data) {
    if (err) return showToast('上传失败');
    if (data && data.url) {
      ws.send(JSON.stringify({ type: 'image', url: data.url, text: file.name }));
    }
  });
}

function renderHistory(messages) {
  messagesEl.innerHTML = '';
  if (!messages || messages.length === 0) {
    addSystemMsg('暂无消息记录');
    return;
  }
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.type === 'system') {
      addSystemMsg(msg.content || msg.text);
    } else if (msg.type === 'image') {
      renderImageMsg(msg, msg.name === myName ? 'self' : 'other');
    } else {
      renderMessage(msg, msg.name === myName ? 'self' : 'other');
    }
  }
  scrollToBottom();
}

function renderMessage(msg, side) {
  var el = document.createElement('div');
  el.className = 'msg msg-' + side;

  var nameEl = document.createElement('div');
  nameEl.className = 'msg-name';
  nameEl.textContent = msg.name;
  el.appendChild(nameEl);

  var textEl = document.createElement('div');
  textEl.textContent = msg.text;
  el.appendChild(textEl);

  var timeEl = document.createElement('div');
  timeEl.className = 'msg-time';
  timeEl.textContent = formatTime(msg.time);
  el.appendChild(timeEl);

  messagesEl.appendChild(el);
  scrollToBottom();
}

function renderImageMsg(msg, side) {
  var el = document.createElement('div');
  el.className = 'msg msg-' + side;

  var nameEl = document.createElement('div');
  nameEl.className = 'msg-name';
  nameEl.textContent = msg.name;
  el.appendChild(nameEl);

  var img = document.createElement('img');
  img.src = msg.url;
  img.alt = msg.text || '图片';
  img.addEventListener('click', function() {
    window.open(msg.url, '_blank');
  });
  el.appendChild(img);

  var timeEl = document.createElement('div');
  timeEl.className = 'msg-time';
  timeEl.textContent = formatTime(msg.time);
  el.appendChild(timeEl);

  messagesEl.appendChild(el);
  scrollToBottom();
}

function addSystemMsg(text) {
  var el = document.createElement('div');
  el.className = 'msg msg-system';
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function renderUsers(users) {
  usersList.innerHTML = '';
  userCount.textContent = users.length;
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    var li = document.createElement('li');
    li.textContent = u.name;
    li.title = u.id;
    usersList.appendChild(li);
  }
}

function scrollToBottom() {
  requestAnimationFrame(function() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function formatTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function showToast(msg) {
  var old = document.querySelector('.toast');
  if (old) old.remove();
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  var timer = setTimeout(function() { el.remove(); }, 2000);
}

// Events
btnJoin.addEventListener('click', join);
inputName.addEventListener('keydown', function(e) { if (e.key === 'Enter') join(); });
btnSend.addEventListener('click', sendText);
inputText.addEventListener('keydown', function(e) { if (e.key === 'Enter') sendText(); });

btnImage.addEventListener('click', function() { inputImage.click(); });
inputImage.addEventListener('change', function() {
  if (inputImage.files.length > 0) {
    sendImage(inputImage.files[0]);
    inputImage.value = '';
  }
});

btnClearMsgs.addEventListener('click', function() {
  if (!confirm('确定清空所有消息记录？')) return;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'clear_msgs' }));
    showToast('已发送清空指令');
  } else {
    xhrSend('DELETE', '/api/messages', null, function(err, data) {
      if (!err) showToast('消息已清空');
      else showToast('操作失败');
    });
  }
});

btnClearAll.addEventListener('click', function() {
  if (!confirm('确定清除所有数据（消息 + 图片文件）？此操作不可恢复！')) return;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'clear_all' }));
    showToast('已发送清除指令');
  } else {
    xhrSend('DELETE', '/api/all', null, function(err, data) {
      if (!err) { showToast('所有数据已清除'); messagesEl.innerHTML = ''; }
      else showToast('操作失败');
    });
  }
});

xhrSend('GET', '/api/info', null, function(err, info) {
  if (!err && info) {
    var ip = (info.ips && info.ips.length > 0) ? info.ips[0] : 'localhost';
    serverInfo.textContent = ip + ':' + info.port + ' | ' + info.online + ' 在线';
  }
});

var params = (function() {
  var p = {}, s = location.search.substring(1).split('&');
  for (var i = 0; i < s.length; i++) {
    var kv = s[i].split('=');
    if (kv[0]) p[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
  }
  return p;
})();

if (params.name) {
  inputName.value = params.name;
  myName = params.name;
  var waitJoin = setInterval(function() {
    if (ws && ws.readyState === 1) {
      clearInterval(waitJoin);
      join();
    }
  }, 200);
}

connect();
