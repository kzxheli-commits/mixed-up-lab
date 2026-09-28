// 静态校验：index.html 引用的资源存在，JS 中 getElementById/$ 的 id 都在 HTML 里
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'client', 'index.html'), 'utf8');
let failures = 0;
const check = (cond, label) => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}`); }
};

// HTML 中声明的 id
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
check(htmlIds.size > 0, `HTML 声明 ${htmlIds.size} 个 id`);

// HTML 引用的本地资源
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  .filter((u) => !u.startsWith('http') && !u.startsWith('#') && !u.startsWith('data:'));
for (const r of refs) {
  check(fs.existsSync(path.join(root, 'client', r)), `资源存在 ${r}`);
}

// JS 引用的 id
const jsDir = path.join(root, 'client', 'js');
const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
const usedIds = new Map();
for (const f of jsFiles) {
  const code = fs.readFileSync(path.join(jsDir, f), 'utf8');
  for (const m of code.matchAll(/getElementById\('([^']+)'\)/g)) {
    usedIds.set(m[1], f);
  }
  for (const m of code.matchAll(/\$\('([^']+)'\)/g)) {
    usedIds.set(m[1], f);
  }
}
check(usedIds.size >= 10, `JS 引用了 ${usedIds.size} 个 DOM id`);
for (const [id, f] of usedIds) {
  check(htmlIds.has(id), `id 存在于 HTML：${id}（${f}）`);
}

// vendor 依赖存在
for (const v of ['vendor/three.module.min.js', 'vendor/cannon-es.js']) {
  check(fs.existsSync(path.join(root, 'client', v)), `vendor 存在 ${v}`);
}

// JS 模块 import 的本地文件存在
for (const f of jsFiles) {
  const code = fs.readFileSync(path.join(jsDir, f), 'utf8');
  for (const m of code.matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = path.resolve(jsDir, m[1]);
    check(fs.existsSync(target), `import 存在 ${f} → ${m[1]}`);
  }
}

console.log(failures === 0 ? '\nDOM 校验通过' : `\n${failures} 项校验失败`);
process.exit(failures ? 1 : 0);
