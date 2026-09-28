// 浏览器端 e2e：headless Edge 加载真实页面，通过 CDP 驱动完整通关
// 用法：node scripts/e2e-browser.mjs http://127.0.0.1:PORT
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = 9333 + Math.floor(Math.random() * 200);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const fs = await import('node:fs');
  const browser = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].find((p) => fs.existsSync(p));
  if (!browser) { console.log('SKIP: 没有可用的 Edge/Chrome'); process.exit(0); }

  const userData = `${process.env.TEMP}\\mul-cdp-${Date.now()}`;
  const edge = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1280,800',
    BASE,
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    // 等 CDP 就绪
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const list = await res.json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch { /* 未就绪 */ }
    }
    if (!target) throw new Error('CDP 目标未出现');

    cdp = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { cdp.on('open', res); cdp.on('error', rej); });
    let msgId = 0;
    const pending = new Map();
    cdp.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message));
        else if (m.result?.exceptionDetails) rej(new Error(m.result.exceptionDetails.text));
        else res(m.result);
      }
    });
    const evaluate = (expression) => new Promise((res, rej) => {
      const id = ++msgId;
      pending.set(id, { res, rej });
      cdp.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });

    // 等页面加载出 __MUL 钩子
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      const r = await evaluate('!!window.__MUL');
      ready = r.result.value === true;
      if (!ready) await sleep(500);
    }
    if (!ready) throw new Error('页面未暴露 __MUL（客户端脚本可能启动失败）');
    console.log('== 页面就绪，开始浏览器端通关 ==');

    // 结算页初始必须不可见：.overlay{display:flex} 曾覆盖 hidden 属性导致卡片常显盖死整个界面
    const vis = await evaluate(
      "getComputedStyle(document.getElementById('report')).display"
    );
    if (vis.result.value !== 'none') throw new Error(`结算页初始可见（display=${vis.result.value}），hidden 被 .overlay 覆盖`);
    console.log('  PASS  结算页初始不可见（[hidden] 压过 .overlay）');

    const expr = `(() => {
      const M = window.__MUL;
      const log = [];
      let failures = 0;
      const check = (c, l) => { log.push((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures++; };
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const wait = async (fn, ms = 6000, label = 'cond') => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(80); }
        log.push('  FAIL  超时: ' + label);
        failures++;
        return false;
      };
      // 分步传送（服务器有 8m/100ms 防瞬移）
      const tp = async (x, y, z) => {
        const b = M.player.body;
        const cur = [b.position.x, b.position.y, b.position.z];
        const d = Math.hypot(x - cur[0], y - cur[1], z - cur[2]);
        const steps = Math.max(1, Math.ceil(d / 5));
        for (let i = 1; i <= steps; i++) {
          b.position.set(
            cur[0] + (x - cur[0]) * i / steps,
            cur[1] + (y - cur[1]) * i / steps,
            cur[2] + (z - cur[2]) * i / steps
          );
          b.velocity.set(0, 0, 0);
          await sleep(130);
        }
      };
      // Bob：独立 WebSocket（模拟第二名玩家）
      const bobMsgs = [];
      const bob = new WebSocket(location.origin.replace('http', 'ws') + '/ws');
      const bobReady = new Promise((res, rej) => { bob.onopen = res; bob.onerror = rej; });
      bob.onmessage = (e) => { try { bobMsgs.push(JSON.parse(e.data)); } catch {} };
      const bobSend = (m) => bob.send(JSON.stringify(m));
      const bobWait = async (fn, ms = 6000, label = 'bob') => wait(() => bobMsgs.some(fn), ms, label);

      return (async () => {
        // 捕获 roundEnd 原始消息与 showReport 异常，用于诊断结算渲染
        M.net.on('roundEnd', (m) => { window.__roundEnd = m; });

        // 1. Alice 创建房间
        M.net.send({ t: 'create', name: 'Alice' });
        check(await wait(() => M.roomCode, 5000, 'joined'), 'Alice 创建房间 ' + M.roomCode);

        // 2. Bob 加入
        await bobReady;
        await sleep(200);
        bobSend({ t: 'join', name: 'Bob', code: M.roomCode });
        check(await bobWait((m) => m.t === 'joined', 5000, 'bob joined'), 'Bob 加入');
        check(await wait(() => M.roomPlayers.length === 2, 5000, 'lobby2'), '大厅 2 人');

        // 3. 开局
        M.net.send({ t: 'start' });
        check(await wait(() => M.state === 'playing', 6000, 'playing'), '进入对局');
        check(M.game.dynamics.size === 7, '场景生成 7 个动态物体');
        check(M.player.enabled === true, '本地玩家获得控制权');

        // 4. 标签枪：传送到 box2 旁改成 CHAIR（headless 无鼠标锁，射线 target 不可用，走协议层）
        await tp(-2, 1.2, 3.4);
        await sleep(250); // 等 pose 到达服务器
        M.net.send({ t: 'tag', objId: 'box2', form: 'CHAIR' });
        check(await wait(() => M.game.dynamics.get('box2')?.form === 'CHAIR', 5000, 'tag'), '标签枪 BOX→CHAIR 生效（视觉重建）');

        // 5. 抓取 box2
        M.interact.grab('box2');
        check(await wait(() => M.interact.held === 'box2', 5000, 'held'), '抓取箱子成功');
        M.interact.release();

        // 6. 物化 → 恢复
        M.net.send({ t: 'morph' });
        check(await wait(() => M.player.form === 'box', 5000, 'morph'), '按 F 物化成箱子');
        M.net.send({ t: 'unmorph' });
        check(await wait(() => M.player.form === 'human', 5000, 'unmorph'), '解除物化恢复人形');

        // 7. Bob 踩压力板 → 侧室门开
        bobSend({ t: 'pose', x: 0, y: 0.1, z: 6, yaw: 0 });
        check(await wait(() => M.puzzle.sideDoorOpen === true, 5000, 'plate'), 'Bob 踩板 → 侧室门开');

        // 8. Alice 进侧室拿椅子交给实验员
        await tp(4.6, 1.2, 7.2);
        await sleep(250);
        M.interact.grab('chair0');
        check(await wait(() => M.interact.held === 'chair0', 5000, 'chair held'), '抓起侧室的椅子');
        await tp(6.5, 1.2, 1.5);
        await sleep(250);
        M.interact.smartE();
        check(await wait(() => M.puzzle.chairGiven === true, 6000, 'chair given'), '交椅给实验员');
        check(await wait(() => M.interact.held === null, 3000, 'chair consumed'), '椅子被实验员收下');

        // 9. 拿能源球（荒诞改标签先测试混乱值路径）
        await sleep(10500); // 等标签枪 10s 冷却（box2 那次已用掉）
        await tp(-7.5, 3.6, -4.5);
        await tp(-7.5, 3.6, -6);
        await sleep(250);
        M.net.send({ t: 'tag', objId: 'orb', form: 'CHAIR' });
        check(await wait(() => M.game.dynamics.get('orb')?.form === 'CHAIR', 5000, 'orb tag'), '把能源球改成椅子（荒诞标签）');
        M.interact.grab('orb');
        check(await wait(() => M.interact.held === 'orb', 5000, 'orb held'), '抓起能源球（椅子形态照样能用）');

        // 10. 插入核心
        await tp(-6.5, 1.2, -3);
        await tp(-6.5, 1.2, -4.8);
        await sleep(250);
        M.interact.smartE();
        check(await wait(() => M.puzzle.corePowered === true, 6000, 'core'), '核心启动');
        check(await wait(() => M.puzzle.exitOpen === true, 3000, 'exit open'), '出口开启');

        // 11. 逃出出口
        await tp(6, 1.2, 0);
        await tp(9.5, 1.2, 0);
        check(await wait(() => M.state === 'done', 6000, 'roundEnd'), '通关触发结算');
        check(!document.getElementById('report').hidden, '实验报告界面显示');
        const body = document.getElementById('report-body');
        check(body.children.length >= 6, '报告统计行渲染（' + body.children.length + ' 行）');
        const raw = window.__roundEnd;
        check(!!raw && !!raw.stats, 'roundEnd 原始消息带 stats（' + (raw ? typeof raw.stats : '无消息') + '）');
        if (raw) {
          try {
            M.ui.showReport(raw);
          } catch (e) {
            log.push('  FAIL  showReport 抛异常: ' + e.message);
            failures++;
          }
        }

        // 12. HUD 状态
        check(document.querySelectorAll('#quests li').length === 4, '任务清单 4 项');
        check(document.getElementById('feed').children.length > 0, '事件 feed 有内容');
        check(document.getElementById('chat-log').children.length >= 0, '聊天区就绪');

        // 13. 结算不卡死：不点按钮，12 秒自动回大厅必须在 UI 层生效（对应"卡在结束页面"反馈）
        check(await wait(
          () => document.getElementById('report').hidden && !document.getElementById('lobby').hidden,
          15000, 'auto back lobby'
        ), '结算 12s 后自动回到大厅界面（不卡结算页）');
        check(M.state === 'room', '状态机回到 room');

        bob.close();
        return { log, failures };
      })().catch((e) => { log.push('  FAIL  异常: ' + e.message); return { log, failures: failures + 1 }; });
    })()`;

    const out = await evaluate(expr);
    const result = out.result.value;
    if (!result) throw new Error('e2e 无返回值');
    for (const line of result.log) console.log(line);
    console.log(result.failures === 0 ? '\nBROWSER E2E PASSED' : `\n${result.failures} BROWSER E2E FAILED`);
    process.exitCode = result.failures ? 1 : 0;
  } finally {
    if (cdp) try { cdp.close(); } catch { /* noop */ }
    edge.kill();
  }
}

main().catch((e) => {
  console.error('浏览器 e2e 异常:', e.message);
  process.exit(1);
});
