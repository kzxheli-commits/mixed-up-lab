// 主入口：大厅状态机、网络消息处理、主循环、上报
import { Net } from './net.js';
import { Game } from './game.js';
import { Player } from './player.js';
import { Interact } from './interact.js';
import { UI } from './ui.js';
import { sfx } from './audio.js';

const net = new Net();
const ui = new UI({
  onCreate: (nick) => { sfx.unlock(); sfx.play('ui'); net.send({ t: 'create', name: nick || '玩家' }); },
  onJoin: (nick, code) => {
    sfx.unlock();
    if (!code || code.length !== 4) { ui.lobbyError('请输入 4 位房间码'); return; }
    sfx.play('ui');
    net.send({ t: 'join', name: nick || '玩家', code });
  },
  onStart: () => { sfx.unlock(); sfx.play('ui'); net.send({ t: 'start' }); },
  onChat: (text) => net.send({ t: 'chat', text }),
  onChatClosed: () => document.getElementById('c').requestPointerLock?.(),
  onBack: () => { /* 大厅由服务器 lobby 消息驱动 */ },
});

// 运行时错误直接显示在大厅，避免静默失败
addEventListener('error', (e) => ui.lobbyError(`脚本错误: ${e.message}`));
addEventListener('unhandledrejection', (e) => ui.lobbyError(`异步错误: ${e.reason?.message || e.reason}`));

const canvas = document.getElementById('c');
const game = new Game(canvas);
const player = new Player(game);
const interact = new Interact(game, player, ui, net);

let state = 'menu';        // menu | room | playing | done
let roomCode = '';
let roomPlayers = [];
let puzzle = { chairGiven: false, corePowered: false, exitOpen: false, sideDoorOpen: false };
let orbTaken = false;
let myCooldowns = { tag: 0, scale: 0, copy: 0, morph: 0 };
let chaos = 0;
let chaosMode = false;
let lowGravOn = false;

/* ---------------- 聊天 / 输入 ---------------- */

addEventListener('keydown', (e) => {
  if (state !== 'playing' && state !== 'done') return;
  if (e.code === 'Enter' && document.activeElement !== document.getElementById('chat-input')) {
    if (player.locked) document.exitPointerLock();
    ui.openChat();
  }
});

player.onToggleMorph = () => {
  if (state !== 'playing') return;
  if (player.form === 'human') net.send({ t: 'morph' });
  else net.send({ t: 'unmorph' });
};

game.onBlast = () => { player.blast(); sfx.play('boom'); };
game.onSpring = () => sfx.play('boing');
player.onSlip = () => {
  net.send({ t: 'chaosEvent', type: 'banana' });
  sfx.play('slip');
  ui.toast('滑——！');
};
player.onPeck = () => { sfx.play('peck'); ui.toast('被鸡撞了！'); };

/* ---------------- 网络消息 ---------------- */

net.on('joined', (m) => {
  roomCode = m.code;
  state = 'room';
  ui.lobbyError('');
});

net.on('lobby', (m) => {
  roomPlayers = m.players;
  if (state === 'menu') return;
  if (m.phase === 'lobby') {
    state = 'room';
    player.enabled = false;
    ui.showRoom(roomCode, roomPlayers, m.hostId, net.myId);
    ui.lobbyError('');
  } else {
    // 对局进行中的名单同步
    ui.setRoomInfo(roomCode, roomPlayers, net.myId);
  }
});

net.on('roundStart', (m) => {
  state = 'playing';
  puzzle = m.puzzle;
  orbTaken = false;
  chaos = m.chaos || 0;
  chaosMode = false;
  lowGravOn = false;
  game.world.gravity.set(0, -22, 0);
  game.spawnObjects(m.objects);
  game.setPuzzle(puzzle);
  player.spawnAt(m.you.spawn, roomPlayers.find((p) => p.id === net.myId)?.color || '#ff6b6b');
  interact.held = null;
  player.enabled = true;
  ui.showHud();
  ui.renderQuests(puzzle, orbTaken);
  ui.setChaos(chaos, false);
  ui.setRoomInfo(roomCode, roomPlayers, net.myId);
  ui.feed('—— 实验开始：启动实验室出口 ——');
  if (!player.locked) ui.toast('点击画面锁定鼠标 · WASD 移动');
});

net.on('snap', (m) => {
  game.setRemotePlayers(m.players, net.myId);
  game.updateObjTargets(m.objs);
  for (const it of m.objs) game.setSim(it.id, it.sim);
  game.setNpc(m.npc);
  chaos = m.chaos ?? chaos;
  game.chaosValue = Math.round(chaos); // 控制台屏幕显示
  ui.setChaos(chaos, chaosMode);

  // 低重力事件：以服务器快照为准
  if (!!m.lowGrav !== lowGravOn) {
    lowGravOn = !!m.lowGrav;
    game.world.gravity.set(0, lowGravOn ? -6 : -22, 0);
    ui.feed(lowGravOn ? '🌙 低重力生效——跳得好高！' : '重力恢复正常');
  }

  // 巨型玩家（含本地）
  const mine = m.players.find((p) => p.id === net.myId);
  if (mine) player.setGiant(mine.giant);

  const cd = m.cooldowns?.[net.myId];
  if (cd) myCooldowns = cd;
  // 物化中：剩余冷却 = 总剩余 - 物化时长（服务器在物化开始时就把结束时间+冷却写入）
  const morphing = player.form === 'box';
  ui.setAbilities({
    tagRemain: myCooldowns.tag,
    scaleRemain: myCooldowns.scale,
    copyRemain: myCooldowns.copy,
    morphRemain: morphing ? Math.max(myCooldowns.morph - 15000, 0) : myCooldowns.morph,
    morphing,
  });
  if (state === 'playing' || state === 'done') {
    ui.setRoomInfo(roomCode, roomPlayers, net.myId);
    ui.renderQuests(puzzle, orbTaken);
  }
});

net.on('ev', (m) => {
  switch (m.kind) {
    case 'tag':
      game.applyTag(m.obj, m.form, m.tags);
      interact.onTagApplied(m.obj, m.form, m.tags);
      break;
    case 'consumed':
      if (interact.held === m.obj) interact.held = null;
      game.removeObject(m.obj);
      sfx.play('door');
      ui.feed(`已交付：${m.obj === 'chair0' ? '椅子' : '能源球'}`);
      break;
    case 'scale':
      game.applyScale(m.obj, m.scale);
      if (m.id !== net.myId) sfx.play('scale');
      break;
    case 'spawn':
      game.spawnObject(m.obj);
      if (m.obj.kind === 'chicken') sfx.play('cluck');
      else if (m.obj.kind === 'banana') sfx.play('ui');
      else if (m.obj.from !== net.myId) sfx.play('copy');
      break;
    case 'despawn':
      if (interact.held === m.obj) interact.held = null;
      game.removeObject(m.obj);
      break;
    case 'event':
      if (m.type === 'rampage') {
        game.rampage();
        ui.feed('💥 物体暴走！（由最近的玩家物理模拟）');
        sfx.play('boom');
      } else if (m.type !== 'chicken') {
        sfx.play('alarm');
      }
      break;
    case 'eventEnd':
      // giant/到期由 snap 权威驱动；lowGravity 结束同理
      break;
    case 'morph': {
      const me = m.id === net.myId;
      if (me) player.setForm(m.form, roomPlayers.find((p) => p.id === net.myId)?.color);
      sfx.play(m.form === 'box' ? 'morph' : 'unmorph');
      if (m.form === 'box') ui.feed(`📦 ${nameOf(m.id)} 变成了箱子`);
      else if (m.form === 'human') ui.feed(`✨ ${nameOf(m.id)} 恢复了原样`);
      break;
    }
    case 'hold':
      if (m.obj === 'orb') orbTaken = true;
      interact.remoteHold(m.obj ? m.id : null, m.obj);
      break;
    case 'puzzle': {
      const before = puzzle;
      puzzle = m.puzzle;
      game.setPuzzle(puzzle);
      ui.renderQuests(puzzle, orbTaken);
      if (puzzle.exitOpen && !before.exitOpen) sfx.play('door');
      else if (puzzle.sideDoorOpen !== before.sideDoorOpen) sfx.play('door');
      break;
    }
    case 'chaos':
      chaos = m.chaos;
      ui.setChaos(chaos, chaosMode);
      break;
    case 'chaosMode':
      if (m.on) {
        chaosMode = true;
        game.chaosBlast();
        ui.feed('💥 CHAOS MODE！全员弹飞！');
      } else {
        chaosMode = false;
        chaos = m.chaos ?? chaos;
      }
      ui.setChaos(chaos, chaosMode);
      break;
    case 'feed':
      ui.feed(m.text);
      break;
    default:
      break;
  }
});

net.on('chat', (m) => ui.chatMsg(m));

net.on('error', (m) => {
  if (state === 'playing' || state === 'done') interact.onServerError(m.msg);
  else ui.lobbyError(m.msg);
});

net.on('roundEnd', (m) => {
  state = 'done';
  player.enabled = false;
  interact.release();
  if (player.locked) document.exitPointerLock();
  sfx.play('win');
  ui.showReport(m);
  ui.prompt(null);
  ui.tagPanel(null);
});

net.on('close', () => {
  if (state === 'playing' || state === 'done') {
    ui.feed('⚠ 与服务器断开连接');
    ui.toast('连接断开，刷新页面重连');
  }
  player.enabled = false;
});

function nameOf(id) {
  return roomPlayers.find((p) => p.id === id)?.name || id;
}

// 测试钩子：浏览器端 e2e（scripts/e2e-browser.mjs）通过它驱动真实客户端
window.__MUL = {
  net, game, player, interact, ui,
  get state() { return state; },
  get roomCode() { return roomCode; },
  get puzzle() { return puzzle; },
  get roomPlayers() { return roomPlayers; },
};

/* ---------------- 上报循环 ---------------- */

setInterval(() => {
  if (state !== 'playing' || !player.enabled) return;
  net.send({ t: 'pose', ...player.pose() });
  const items = [];
  for (const d of game.dynamics.values()) {
    if (d.removed || d.sim !== net.myId) continue;
    items.push({
      id: d.id,
      p: [+d.body.position.x.toFixed(3), +d.body.position.y.toFixed(3), +d.body.position.z.toFixed(3)],
      q: [+d.body.quaternion.x.toFixed(4), +d.body.quaternion.y.toFixed(4), +d.body.quaternion.z.toFixed(4), +d.body.quaternion.w.toFixed(4)],
    });
  }
  if (items.length) net.send({ t: 'objpose', items });
}, 100);

/* ---------------- 主循环 ---------------- */

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'playing' || state === 'done') {
    player.update(dt);
    game.step(dt, player.body);
    if (state === 'playing') interact.update();
    else { ui.prompt(null); ui.tagPanel(null); }
  } else {
    game.step(dt, null);
  }
  requestAnimationFrame(frame);
}

/* ---------------- 启动 ---------------- */

(async () => {
  try {
    await net.connect();
    document.title = 'MUL connected';
  } catch (e) {
    ui.lobbyError('无法连接服务器：' + e.message);
    document.title = 'MUL connect-failed';
  }
  ui.showLobby();
  document.getElementById('nick').focus();
  requestAnimationFrame(frame);
})();
