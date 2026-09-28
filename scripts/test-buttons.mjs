// 三按钮协作谜题测试（设计书 §24 谜题3）：地面/墙面/高处同时按住 1 秒 → 暴力直通出口
// 用法：node scripts/test-buttons.mjs ws://127.0.0.1:PORT/ws
import WebSocket from 'ws';

const BASE = process.argv[2] || 'ws://127.0.0.1:3000/ws';
let failures = 0;
const check = (cond, label) => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.ws = new WebSocket(BASE);
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      if (this.msgs.length > 500) this.msgs.splice(0, 250);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (w.pred(m)) { this.waiters.splice(i, 1); clearTimeout(w.timer); w.res(m); }
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
  }
}

async function main() {
  console.log('== 开局 ==');
  const A = new Client('A');
  const B = new Client('B');
  await Promise.all([A.ready, B.ready]);
  A.send({ t: 'create', name: 'Alice' });
  const j = await A.wait((m) => m.t === 'joined');
  B.send({ t: 'join', code: j.code, name: 'Bob' });
  await B.wait((m) => m.t === 'joined');
  A.send({ t: 'start' });
  const [rsA, rsB] = await Promise.all([
    A.wait((m) => m.t === 'roundStart'),
    B.wait((m) => m.t === 'roundStart'),
  ]);
  A.pos = [...rsA.you.spawn];
  B.pos = [...rsB.you.spawn];
  check(rsA.puzzle.buttons.length === 3, 'puzzle 带 3 按钮状态字段');

  console.log('== 单按钮触发部分状态 ==');
  // A 站地面按钮
  await A.moveTo(2.5, 0, 3.5);
  const btnA = await A.wait(
    (m) => m.t === 'ev' && m.kind === 'puzzle' && m.puzzle.buttons[0] === true, 5000, 'ground pressed'
  );
  check(btnA.puzzle.buttons[0] === true, '地面按钮按住 1s 后变绿');
  check(btnA.puzzle.exitOpen === false, '只有一个按钮时出口不开');

  console.log('== 三按钮同时按住 → 暴力直通 ==');
  // B 站墙按钮
  await B.moveTo(-1.5, 0, -7.0);
  // B 把 box3 放到高处按钮（B 距高处按钮最近，模拟权归 B）——发两次确保 sim 已切换
  await sleep(250);
  B.send({ t: 'objpose', items: [{ id: 'box3', p: [5.5, 2.1, -7.5], q: [0, 0, 0, 1] }] });
  await sleep(300);
  B.send({ t: 'objpose', items: [{ id: 'box3', p: [5.5, 2.1, -7.5], q: [0, 0, 0, 1] }] });

  const opened = await B.wait(
    (m) => m.t === 'ev' && m.kind === 'puzzle' && m.puzzle.buttonOpen === true, 6000, 'button open'
  );
  check(opened.puzzle.buttons.every(Boolean), `三个按钮全绿 (${opened.puzzle.buttons.join(',')})`);
  check(opened.puzzle.exitOpen === true, '三按钮直通 → exitOpen');
  const feed = await A.wait((m) => m.t === 'ev' && m.kind === 'feed' && /暴力解锁/.test(m.text), 3000, 'feed');
  check(/暴力解锁出口/.test(feed.text), `播报：${feed.text}`);

  console.log('== 走出出口结算 ==');
  await A.moveTo(6, 1, 0);
  await A.moveTo(9.5, 1, 0);
  const end = await A.wait((m) => m.t === 'roundEnd', 5000, 'roundEnd');
  check(end.puzzle.buttonOpen === true, '结算 puzzle 携带 buttonOpen');
  check(end.by.name === 'Alice', `触发者 ${end.by.name}`);

  A.ws.close(); B.ws.close();
  console.log(failures === 0 ? '\nBUTTON TESTS PASSED' : `\n${failures} BUTTON TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('按钮测试异常:', e.message);
  process.exit(1);
});
