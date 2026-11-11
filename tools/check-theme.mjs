import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const errors = [];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

const theme = read('lib/theme.css');
const fix = read('lib/layout-fix.css');
const host = read('lib/index.js');

if (!fix.includes('.md-table-wide')) {
  errors.push('layout-fix.css 里缺少 .md-table-wide 规则');
}
if (!fix.includes('overflow-wrap: anywhere')) {
  errors.push('layout-fix.css 里缺少超长文字的换行规则');
}
if (!/table-layout:\s*auto/.test(fix)) {
  errors.push('layout-fix.css 里缺少 table-layout: auto');
}
if (/(xMeOpW|_tableScroll_|_markdown_1ypvv_)/.test(fix)) {
  errors.push('layout-fix.css 使用了带构建哈希的类名，升级 DSH 后会失效');
}
if (!host.includes("'layout-fix.css'")) {
  errors.push('lib/index.js 没有把 layout-fix.css 加入注入列表');
}

/*
 * theme.css 里保留一份兼容副本，旧宿主不用重启就能继续生效；layout-fix.css
 * 始终接在后面，保证主题升级把副本冲掉后修复仍然存在，也保证以后新增的
 * 布局修正能直接生效。副本在不在都不影响自检，关键是独立文件完整。
 */
const hasCompatCopy = theme.includes('.md-table-wide');

if (errors.length) {
  console.error('主题自检失败：');
  for (const message of errors) console.error(`- ${message}`);
  process.exit(1);
}

console.log(
  hasCompatCopy
    ? '主题自检通过：theme.css 有兼容副本，layout-fix.css 始终追加注入。'
    : '主题自检通过：theme.css 没有副本，layout-fix.css 仍会追加注入。',
);
