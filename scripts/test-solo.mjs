// 单人开始测试：1 个客户端即可创建并开始对局
// 用法：node scripts/test-solo.mjs ws://127.0.0.1:PORT/ws
import WebSocket from 'ws';

const BASE = process.argv[2] || 'ws://127.0.0.1:3000/ws';
let failures = 0;
const check = (cond, label) => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}`); }
};

const ws = new WebSocket(BASE);
const msgs = [];
ws.on('message', (raw) => msgs.push(JSON.parse(raw.toString())));
const wait = (pred, ms = 5000, label = 'msg') => new Promise((res, rej) => {
  const t0 = Date.now();
  const timer = setInterval(() => {
    const hit = msgs.find(pred);
    if (hit) { clearInterval(timer); res(hit); }
    else if (Date.now() - t0 > ms) { clearInterval(timer); rej(new Error(`超时: ${label}`)); }
  }, 50);
});

ws.on('open', async () => {
  try {
    ws.send(JSON.stringify({ t: 'create', name: 'Lonely' }));
    const j = await wait((m) => m.t === 'joined');
    check(/^[A-Z2-9]{4}$/.test(j.code), `单人创建房间 ${j.code}`);

    ws.send(JSON.stringify({ t: 'start' }));
    const rs = await wait((m) => m.t === 'roundStart', 5000, 'roundStart');
    check(rs.objects.length === 7, '单人成功开局（7 个动态物体）');

    const state = await wait((m) => m.t === 'snap', 4000, 'snap');
    check(state.players.length === 1, '快照只有 1 名玩家');

    check(msgs.every((m) => !(m.t === 'error' && /至少需要/.test(m.msg || ''))), '无"至少需要 2 人"拒绝');

    // 断开后房间应被回收（防止僵尸房泄漏）
    ws.close();
    await new Promise((r) => setTimeout(r, 700));
    const portNum = new URL(BASE).port || '3000';
    const dbg = await fetch(`http://127.0.0.1:${portNum}/debug`).then((r) => r.json());
    check(!dbg.rooms.some((r) => r.code === j.code), '断线后房间被回收（无僵尸房）');

    console.log(failures === 0 ? '\nSOLO TESTS PASSED' : `\n${failures} SOLO TEST(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  } catch (e) {
    console.error('单人测试异常:', e.message);
    process.exit(1);
  }
});
