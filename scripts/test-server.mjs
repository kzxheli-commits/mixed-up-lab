// 端到端测试：2 个 ws 客户端跑完整通关流程（标签枪/物化/压力板/双谜题/出口/结算）
// 用法：node scripts/test-server.mjs ws://127.0.0.1:PORT/ws
import WebSocket from 'ws';

const BASE = process.argv[2] || 'ws://127.0.0.1:3000/ws';
let failures = 0;

function check(cond, label) {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.ws = new WebSocket(BASE);
    this.ready = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      if (this.msgs.length > 600) this.msgs.splice(0, 300);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (w.pred(m)) {
          this.waiters.splice(i, 1);
          clearTimeout(w.timer);
          w.res(m);
        }
      }
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 5000, label = 'message') {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const w = { pred, res };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        rej(new Error(`${this.name} 超时等待 ${label}`));
      }, ms);
      this.waiters.push(w);
    });
  }
  clear() { this.msgs.length = 0; }
  close() { this.ws.close(); }

  // 分步传送（服务器有防瞬移：单次位移上限 8m）
  async moveTo(x, y, z) {
    const cur = this.pos || [x, y, z];
    const d = Math.hypot(x - cur[0], y - cur[1], z - cur[2]);
    const steps = Math.max(1, Math.ceil(d / 5));
    for (let i = 1; i <= steps; i++) {
      const px = cur[0] + ((x - cur[0]) * i) / steps;
      const py = cur[1] + ((y - cur[1]) * i) / steps;
      const pz = cur[2] + ((z - cur[2]) * i) / steps;
      this.send({ t: 'pose', x: px, y: py, z: pz, yaw: 0 });
      this.pos = [px, py, pz];
      await sleep(60);
    }
    this.pos = [x, y, z];
  }
}

async function main() {
  console.log('== 连接与大厅 ==');
  const A = new Client('A');
  const B = new Client('B');
  await Promise.all([A.ready, B.ready]);
  check(true, '两端均连接');

  A.send({ t: 'create', name: 'Alice' });
  const joinedA = await A.wait((m) => m.t === 'joined', 4000, 'joinedA');
  check(/^[A-Z2-9]{4}$/.test(joinedA.code), `房间码格式 ${joinedA.code}`);
  check(joinedA.isHost, '创建者是房主');

  const C = new Client('C');
  await C.ready;
  C.send({ t: 'join', code: 'ZZZZ', name: 'X' });
  const badRoom = await C.wait((m) => m.t === 'error', 4000, 'bad room');
  check(/不存在/.test(badRoom.msg), '错误房间码被拒绝');
  C.close();

  B.send({ t: 'join', code: joinedA.code, name: 'Bob' });
  await B.wait((m) => m.t === 'joined');
  const lobby = await A.wait((m) => m.t === 'lobby' && m.players.length === 2, 4000, 'lobby2');
  check(lobby.players.length === 2, '两人入厅');

  A.clear(); B.clear();
  A.send({ t: 'start' });
  const [rsA, rsB] = await Promise.all([
    A.wait((m) => m.t === 'roundStart', 5000, 'roundStartA'),
    B.wait((m) => m.t === 'roundStart', 5000, 'roundStartB'),
  ]);
  check(rsA.objects.length === 7 && rsB.objects.length === 7, '两端拿到 7 个动态物体');
  check(rsA.objects.find((o) => o.id === 'orb').key === true, '能源球带关键物标志');
  A.pos = [...rsA.you.spawn];
  B.pos = [...rsB.you.spawn];

  console.log('== 标签枪 ==');
  // Alice 传送到 box2 旁改标签
  await A.moveTo(-2, 1, 3.4);
  A.send({ t: 'tag', objId: 'box2', form: 'CHAIR' });
  const tagEv = await B.wait((m) => m.t === 'ev' && m.kind === 'tag' && m.obj === 'box2', 4000, 'tag ev');
  check(tagEv.form === 'CHAIR' && tagEv.tags.includes('WOOD'), `BOX→CHAIR 广播 (${tagEv.form})`);

  A.clear();
  A.send({ t: 'tag', objId: 'box2', pair: 'HEAVY' });
  const cd = await A.wait((m) => m.t === 'error' && /冷却/.test(m.msg), 4000, 'tag cooldown');
  check(true, `冷却生效: ${cd.msg}`);

  // 距离校验
  await sleep(10200);
  await A.moveTo(6, 1, 5);
  A.clear();
  A.send({ t: 'tag', objId: 'box2', pair: 'HEAVY' });
  const far = await A.wait((m) => m.t === 'error', 4000, 'range');
  check(/距离太远/.test(far.msg), `距离校验: ${far.msg}`);

  console.log('== 玩家物化 ==');
  await sleep(10200);
  A.clear();
  A.send({ t: 'morph' });
  const morphEv = await B.wait((m) => m.t === 'ev' && m.kind === 'morph' && m.form === 'box', 4000, 'morph');
  check(morphEv.form === 'box', '物化广播给他人');
  A.send({ t: 'unmorph' });
  const un = await A.wait((m) => m.t === 'ev' && m.kind === 'morph' && m.form === 'human', 4000, 'unmorph');
  check(un.form === 'human', '可主动解除物化');
  A.send({ t: 'morph' });
  const cd2 = await A.wait((m) => m.t === 'error' && /冷却/.test(m.msg), 4000, 'morph cd');
  check(true, `物化冷却: ${cd2.msg}`);

  console.log('== 压力板与侧室 ==');
  await B.moveTo(0, 0.2, 6);
  const plateOn = await A.wait((m) => m.t === 'ev' && m.kind === 'puzzle' && m.puzzle.sideDoorOpen === true, 4000, 'plate on');
  check(plateOn.puzzle.sideDoorOpen, '踩住压力板 → 侧室门开');

  await B.moveTo(4.6, 0.5, 7.2);
  B.send({ t: 'grab', id: 'chair0' });
  const hold = await A.wait((m) => m.t === 'ev' && m.kind === 'hold' && m.obj === 'chair0', 4000, 'grab');
  check(hold.obj === 'chair0', `Bob 抓起侧室的椅子 (by ${hold.id})`);
  await B.moveTo(5.5, 0.5, 1);
  await B.moveTo(7.2, 0.5, 1.5);
  B.send({ t: 'interact', target: 'npc' });
  const chairDone = await B.wait((m) => m.t === 'ev' && m.kind === 'puzzle' && m.puzzle.chairGiven === true, 4000, 'chair given');
  check(chairDone.puzzle.chairGiven, '交椅给实验员 → chairGiven');

  console.log('== 荒诞标签与混乱值 ==');
  await A.moveTo(6, 1, 5);
  await sleep(10200);
  await A.moveTo(-7.5, 3.4, -4.5); // 分步上高台方向
  await A.moveTo(-7.5, 3.4, -6);
  A.clear(); B.clear();
  A.send({ t: 'tag', objId: 'orb', form: 'CHAIR' });
  const chaos = await B.wait((m) => m.t === 'ev' && m.kind === 'chaos' && m.chaos >= 10, 4000, 'chaos');
  check(chaos.chaos >= 10, `把能源球改成椅子 → 混乱值 ${chaos.chaos}`);

  console.log('== 能源球与核心 ==');
  A.clear();
  A.send({ t: 'tag', objId: 'orb', form: 'CHAIR' }); // 冷却中应被拒
  const cd3 = await A.wait((m) => m.t === 'error' && /冷却/.test(m.msg), 4000, 'orb tag cd');
  check(true, `关键物改标签受冷却限制: ${cd3.msg}`);

  // 等冷却后把 orb 改回（保持可插核 —— 其实 form 不影响 key，CHAIR 形态的能源球照样能插核，这正是"没有唯一正确答案"）
  A.send({ t: 'grab', id: 'orb' });
  const holdOrb = await A.wait((m) => m.t === 'ev' && m.kind === 'hold' && m.obj === 'orb', 4000, 'grab orb');
  check(holdOrb.obj === 'orb', '抓到能源球');

  await A.moveTo(-6.5, 1, -3);
  await A.moveTo(-6.5, 1, -4.6);
  A.send({ t: 'objpose', items: [{ id: 'orb', p: [-6.5, 1, -4.6], q: [0, 0, 0, 1] }] });
  A.send({ t: 'interact', target: 'core' });
  const coreDone = await A.wait((m) => m.t === 'ev' && m.kind === 'puzzle' && m.puzzle.corePowered === true, 5000, 'core');
  check(coreDone.puzzle.corePowered, '插入能源球 → 核心启动');
  check(coreDone.puzzle.exitOpen === true, '双条件齐 → 出口开启');

  console.log('== 出口与结算 ==');
  await A.moveTo(6, 1, 0);
  A.clear();
  await A.moveTo(9.5, 1, 0);
  const end = await A.wait((m) => m.t === 'roundEnd', 5000, 'roundEnd');
  check(end.by.name === 'Alice', `结算触发者 ${end.by.name}`);
  check(end.stats.tags >= 2 && end.stats.morphs >= 1, `统计记录 tags=${end.stats.tags} morphs=${end.stats.morphs}`);
  check(typeof end.title === 'string' && end.title.length > 0, `称号：${end.title}`);
  check(/^\d\d:\d\d$/.test(end.time), `用时 ${end.time}`);

  console.log('== 聊天与回大厅 ==');
  B.send({ t: 'chat', text: '这也行？！' });
  const chat = await A.wait((m) => m.t === 'chat', 4000, 'chat');
  check(chat.from === 'Bob' && /这也行/.test(chat.text), `聊天广播 ${chat.from}: ${chat.text}`);

  const back = await A.wait((m) => m.t === 'lobby' && m.phase === 'lobby', 15000, 'back lobby');
  check(back.phase === 'lobby', '结算展示后自动回大厅');

  console.log('== 断线处理 ==');
  B.close();
  const afterDc = await A.wait(
    (m) => m.t === 'lobby' && m.players.length === 1, 5000, 'dc lobby'
  );
  check(afterDc.players.length === 1, '断线后名单更新');

  A.close();
  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('测试异常:', e.message);
  process.exit(1);
});
