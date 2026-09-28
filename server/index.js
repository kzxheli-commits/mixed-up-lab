// 入口：HTTP 静态资源 + WebSocket 接入 + 房间枢纽 + 10Hz 权威循环
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, createRoomCode } from './world.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const PORT = Number(process.env.PORT) || 3000;
// 随机事件首个触发延迟（毫秒）；0 = 禁用随机事件
const EVENT_MS = process.env.EVENT_MS !== undefined ? Number(process.env.EVENT_MS) : 40_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(CLIENT_DIR, rel);
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // 禁缓存：避免客户端拿着旧版 JS 与新服务器协议漂移
      'Cache-Control': 'no-cache, must-revalidate',
    });
    res.end(data);
  });
});

/* ---------------- 房间枢纽 ---------------- */

const rooms = new Map();
const conns = new Map(); // ws -> {id, code, name}

function makeCode() {
  let code = createRoomCode();
  while (rooms.has(code)) code = createRoomCode();
  return code;
}

function err(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'error', msg }));
}

function roomOf(ws) {
  const c = conns.get(ws);
  if (!c || !c.code) return null;
  return rooms.get(c.code) || null;
}

function handle(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return err(ws, '消息格式错误'); }
  const conn = conns.get(ws);
  if (!conn) return err(ws, '连接未注册');
  const { t } = msg || {};

  if (t === 'create' || t === 'join') {
    if (conn.code) return err(ws, '你已经在房间里');
    let room;
    if (t === 'create') {
      const code = makeCode();
      room = new Room(code, { send: broadcastTo, eventMs: EVENT_MS });
      rooms.set(code, room);
    } else {
      const code = String(msg.code || '').toUpperCase().trim();
      room = rooms.get(code);
      if (!room) return err(ws, '房间不存在');
    }
    const res = room.addPlayer(conn.id, msg.name);
    if (res.error) {
      if (t === 'create') { room.destroy?.(); rooms.delete(room.code); }
      return err(ws, res.error);
    }
    conn.code = room.code;
    conn.name = res.player.name;
    ws.send(JSON.stringify({
      t: 'joined', id: conn.id, code: room.code, name: res.player.name,
      isHost: conn.id === room.hostId,
    }));
    room.lobby();
    return;
  }

  const room = roomOf(ws);
  if (!room) return err(ws, '先创建或加入房间');

  let error = null;
  switch (t) {
    case 'start': error = room.startMatch(conn.id); break;
    case 'pose': room.handlePose(conn.id, msg); break;
    case 'objpose': room.handleObjPose(conn.id, msg.items); break;
    case 'grab': error = room.handleGrab(conn.id, msg.id); break;
    case 'release': error = room.handleRelease(conn.id); break;
    case 'throw': error = room.handleThrow(conn.id, msg.v); break;
    case 'tag': error = room.handleTag(conn.id, msg); break;
    case 'scale': error = room.handleScale(conn.id, msg); break;
    case 'copy': error = room.handleCopy(conn.id, msg); break;
    case 'chaosEvent': error = room.handleChaosEvent(conn.id, msg.type); break;
    case 'morph': error = room.handleMorph(conn.id); break;
    case 'unmorph': error = room.handleUnmorph(conn.id); break;
    case 'interact': error = room.handleInteract(conn.id, msg.target); break;
    case 'chat': error = room.chat(conn.id, msg.text); break;
    case 'backLobby':
      // 结算页「返回大厅」：立即结束展示回大厅（不等 12 秒）
      if (room.phase === 'done') room.toLobby();
      break;
    case 'leave':
      room.removePlayer(conn.id);
      conn.code = null;
      ws.send(JSON.stringify({ t: 'left' }));
      break;
    default: error = `未知消息：${t}`;
  }
  if (error) err(ws, error);
}

function broadcastTo(id, payload) {
  const text = JSON.stringify(payload);
  for (const [sock, c] of conns) {
    if (c.id === id && sock.readyState === sock.OPEN) {
      try { sock.send(text); } catch { /* 已关闭 */ }
    }
  }
}

function disconnect(ws) {
  const conn = conns.get(ws);
  if (!conn) return;
  conns.delete(ws);
  const room = conn.code ? rooms.get(conn.code) : null;
  if (room) {
    room.markDisconnected(conn.id);
    if (room.players.length === 0) {
      rooms.delete(room.code);
    }
  }
}

/* ---------------- WebSocket 接入与权威循环 ---------------- */

const wss = new WebSocketServer({ server, path: '/ws' });
let nextId = 1;

wss.on('connection', (ws) => {
  const id = `p${nextId++}`;
  conns.set(ws, { id, code: null, name: null });
  ws.send(JSON.stringify({ t: 'hello', id }));
  ws.on('message', (raw) => {
    try { handle(ws, raw.toString()); } catch (e) { console.error('handle error', e); }
  });
  ws.on('close', () => disconnect(ws));
  ws.on('error', () => disconnect(ws));
});

// 10Hz：规则检查（物化到期/压力板/模拟权）+ 状态快照
setInterval(() => {
  for (const room of rooms.values()) {
    try { room.tick(); room.snap(); } catch (e) { console.error('tick error', room.code, e); }
  }
}, 100);

server.listen(PORT, () => {
  console.log(`Mixed Up Lab server http://localhost:${PORT}  (ws /ws)`);
});

export { server, rooms };
