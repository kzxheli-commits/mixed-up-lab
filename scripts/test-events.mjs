// 事件与新能力测试：复制枪 / 缩放枪 / 混乱上报 / 随机事件调度
// 用法：node scripts/test-events.mjs ws://127.0.0.1:PORT/ws
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
  clear() { this.msgs.length = 0; }
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
  console.log('== 连接与开局 ==');
  const A = new Client('A');
  const B = new Client('B');
  await Promise.all([A.ready, B.ready]);
  A.send({ t: 'create', name: 'Alice' });
  const j = await A.wait((m) => m.t === 'joined');
  B.send({ t: 'join', code: j.code, name: 'Bob' });
  await B.wait((m) => m.t === 'joined');
  A.send({ t: 'start' });
  const rs = await A.wait((m) => m.t === 'roundStart');
  A.pos = [...rs.you.spawn];
  check(true, `开局成功 ${j.code}`);

  console.log('== 复制枪 ==');
  // 关键物体不可复制
  A.send({ t: 'copy', objId: 'orb' });
  const keyErr = await A.wait((m) => m.t === 'error', 4000, 'key copy');
  check(/关键物体/.test(keyErr.msg), `关键物拒绝复制: ${keyErr.msg}`);

  // 正常复制 box2
  await A.moveTo(-2, 1, 3.4);
  await sleep(150);
  A.send({ t: 'copy', objId: 'box2' });
  const spawn = await A.wait((m) => m.t === 'ev' && m.kind === 'spawn' && m.obj?.id === 'box2_c1', 5000, 'spawn');
  check(spawn.obj.form === 'BOX' && Array.isArray(spawn.obj.size), '复制体生成（box2_c1）');

  // 冷却
  A.clear();
  A.send({ t: 'copy', objId: 'box1' });
  const cd = await A.wait((m) => m.t === 'error' && /冷却/.test(m.msg), 4000, 'copy cd');
  check(true, `复制枪冷却: ${cd.msg}`);

  console.log('== 缩放枪 ==');
  A.clear();
  A.send({ t: 'scale', objId: 'box2', dir: 1 });
  const scaled = await A.wait((m) => m.t === 'ev' && m.kind === 'scale' && m.obj === 'box2', 5000, 'scale');
  check(scaled.scale === 1.6, `缩放至 1.6x (${scaled.scale})`);

  A.clear();
  A.send({ t: 'scale', objId: 'box2', dir: -1 });
  const cd2 = await A.wait((m) => m.t === 'error' && /冷却/.test(m.msg), 4000, 'scale cd');
  check(true, `缩放枪冷却: ${cd2.msg}`);

  console.log('== 混乱上报（香蕉皮通道） ==');
  A.clear();
  A.send({ t: 'chaosEvent', type: 'banana' });
  const chaos = await A.wait((m) => m.t === 'ev' && m.kind === 'chaos' && m.chaos >= 3, 4000, 'banana chaos');
  check(chaos.chaos >= 3, `踩香蕉皮上报 → 混乱值 ${chaos.chaos}`);

  console.log('== 随机事件调度（EVENT_MS 短配置） ==');
  const ev = await A.wait((m) => m.t === 'ev' && m.kind === 'event', 8000, 'random event');
  check(typeof ev.type === 'string' && ev.type.length > 0, `随机事件触发: ${ev.type}`);
  // 事件对象应通过 spawn 进入世界（鸡/香蕉类型时）
  if (ev.type === 'chicken' || ev.type === 'banana') {
    const spawned = await A.wait(
      (m) => m.t === 'ev' && m.kind === 'spawn' && m.obj && String(m.obj.id).startsWith(ev.type),
      5000, 'event spawn'
    );
    check(spawned.obj.kind === ev.type, `事件物体进入世界: ${spawned.obj.id}`);
  }
  // giant / lowGravity 应有结束广播字段（end 由 tick 到期触发，此处只验证 event 已带类型）
  check(['chicken', 'giant', 'lowGravity', 'banana', 'rampage'].includes(ev.type), '事件类型在设计书事件表内');

  A.ws.close(); B.ws.close();
  console.log(failures === 0 ? '\nEVENT TESTS PASSED' : `\n${failures} EVENT TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('事件测试异常:', e.message);
  process.exit(1);
});
