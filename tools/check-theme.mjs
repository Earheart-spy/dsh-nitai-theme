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
/*
 * 默认档位与 theme.css 要对得上。
 *
 * lib/surfaces.js 的 THEME_DEFAULTS 是「跟随主题默认」实际用的档位，theme.css 末尾
 * 那段「元素默认凹凸」才是真正生效的样式。两处一旦走偏，面板上写的是「默认＝内凹·浅」，
 * 界面上却是别的效果，而且很难发现，所以这里逐条核对：每一档的 box-shadow 值都必须
 * 出现在 theme.css 的相关规则里。
 */
function checkThemeDefaults() {
  const surfaces = read('lib/surfaces.js');
  const match = surfaces.match(/export const THEME_DEFAULTS = {([\s\S]*?)\n\};/);
  if (!match) {
    errors.push('lib/surfaces.js 里没有找到 THEME_DEFAULTS 表');
    return 0;
  }
  const expected = {
    'raised-sm': 'var(--nt-raised-sm)',
    'raised-md': 'var(--nt-raised)',
    'raised-lg': 'var(--nt-raised-lg)',
    'inset-sm': 'var(--nt-inset-soft)',
    'inset-md': 'var(--nt-inset)',
    flat: 'none',
    outline: 'inset 0 0 0 1px var(--nt-hairline-soft)'
  };
  let checked = 0;
  const body = match[1];
  const entries = body.matchAll(/'?([a-z][a-z-]*)'?:\s*\{([^}]*)\}/g);
  for (const entry of entries) {
    const id = entry[1];
    const states = entry[2].matchAll(/'?([a-z]+)'?:\s*'([a-z-]+)'/g);
    for (const state of states) {
      const style = state[2];
      const css = expected[style];
      checked += 1;
      if (!css) {
        errors.push(`THEME_DEFAULTS 里 ${id} 的 ${state[1]} 用了未知档位 ${style}`);
        continue;
      }
      if (!theme.includes(css)) {
        errors.push(`theme.css 里没有 ${id} 的默认档位 ${style}（应为 ${css}）`);
      }
    }
  }
  return checked;
}

const defaultChecks = checkThemeDefaults();

const hasCompatCopy = theme.includes('.md-table-wide');

if (errors.length) {
  console.error('主题自检失败：');
  for (const message of errors) console.error(`- ${message}`);
  process.exit(1);
}

console.log(
  hasCompatCopy
    ? '主题自检通过：theme.css 有兼容副本，layout-fix.css 始终追加注入，默认档位 ' + defaultChecks + ' 处对得上。'
    : '主题自检通过：theme.css 没有副本，layout-fix.css 仍会追加注入，默认档位 ' + defaultChecks + ' 处对得上。',
);
