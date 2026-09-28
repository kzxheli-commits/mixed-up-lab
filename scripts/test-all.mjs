// 一键测试：拉起临时服务器并跑全部套件
// 用法：npm test
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 3300 + Math.floor(Math.random() * 300);
const port2 = port + 1;

function startServer(env) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return new Promise((res) => {
    const timer = setTimeout(() => res(child), 4000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('Mixed Up Lab server')) {
        clearTimeout(timer);
        res(child);
      }
    });
  });
}

function run(args) {
  return new Promise((res) => {
    const p = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
    p.on('exit', (code) => res(code || 0));
  });
}

const servers = [];
let failures = 0;
try {
  console.log('--- 启动测试服务器 ---');
  servers.push(await startServer({ PORT: String(port) }));
  // 事件服务器：缩短随机事件首触发延迟
  servers.push(await startServer({ PORT: String(port2), EVENT_MS: '700' }));

  const suites = [
    ['DOM 静态校验', ['scripts/check-dom.mjs']],
    ['服务端全流程（通关）', ['scripts/test-server.mjs', `ws://127.0.0.1:${port}/ws`]],
    ['事件与新能力（复制/缩放/随机事件）', ['scripts/test-events.mjs', `ws://127.0.0.1:${port2}/ws`]],
    ['浏览器端 e2e（真实页面通关）', ['scripts/e2e-browser.mjs', `http://127.0.0.1:${port}`]],
  ];
  for (const [name, args] of suites) {
    console.log(`\n===== ${name} =====`);
    const code = await run(args);
    if (code !== 0) failures++;
  }
} finally {
  for (const s of servers) s.kill();
}

console.log(failures === 0 ? '\n全部测试套件通过' : `\n${failures} 个测试套件失败`);
process.exit(failures ? 1 : 0);
