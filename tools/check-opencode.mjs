/*
 * OpenCode Go 展示模式的自检脚本。
 *
 * 这里只检查“一旦被改坏就会静默失效”的部分：
 * 内置额度表是否完整、三档换算是否正确、用量数字是否被夹在 0~100、
 * 文档页解析能不能认出模型 id，以及宿主和前端是否还引用着这套逻辑。
 *
 * 用法：node tools/check-opencode.mjs
 * 全部通过时打印一行结论并以 0 退出；任何一项不对就打印原因并以 1 退出。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BUILTIN_MONTHLY_LIMITS,
  OPENCODE_PROVIDERS,
  DEEPSEEK_PROVIDERS,
  deriveLimitTiers,
  normalizeLimitName,
  normalizeUsage,
  parseDocsLimits,
  parseLimitsTable,
  parseModelIdTable,
} from '../lib/opencode.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const problems = []

function expect(label, condition, detail) {
  if (!condition) problems.push(detail ? `${label}（${detail}）` : label)
}

/* 1. 内置额度表：模型数量、代表作数值、键名形状。 */
const builtinIds = Object.keys(BUILTIN_MONTHLY_LIMITS)
expect('内置额度表至少 20 个模型', builtinIds.length >= 20, `当前 ${builtinIds.length} 个`)
expect('deepseek-v4.1-flash 月额度应为 100', BUILTIN_MONTHLY_LIMITS['deepseek-v4.1-flash'] === 100)
expect('deepseek-v4-pro 月额度应为 15', BUILTIN_MONTHLY_LIMITS['deepseek-v4-pro'] === 15)
expect('claude-haiku-5-5 月额度应为 15', BUILTIN_MONTHLY_LIMITS['claude-haiku-5-5'] === 15)
for (const id of builtinIds) {
  /* 0 表示“不限量”，免费档的模型就是这种；其余必须是正整数。 */
  const value = BUILTIN_MONTHLY_LIMITS[id]
  expect(`内置额度 ${id} 必须是 0（不限量）或正整数`, Number.isInteger(value) && value >= 0)
}

/* 2. 三档换算：5 小时 20%、周 50%、月 100%。 */
const tiers = deriveLimitTiers(100)
expect('deriveLimitTiers(100) 的 5 小时额度应为 20', tiers.hours5 === 20, JSON.stringify(tiers))
expect('deriveLimitTiers(100) 的周额度应为 50', tiers.weekly === 50, JSON.stringify(tiers))
expect('deriveLimitTiers(100) 的月额度应为 100', tiers.monthly === 100, JSON.stringify(tiers))

/* 3. 用量归一化：结构正确、百分比被夹在 0~100、缺失字段为 null。 */
const usage = normalizeUsage({
  usage: {
    rolling: { status: 'ok', percent: 13, resetsAt: '2026-11-11T13:26:23.000Z' },
    weekly: { status: 'ok', percent: 150 },
    monthly: { status: 'ok', percent: -3 },
  },
})
expect('normalizeUsage 能读出 rolling', !!usage && !!usage.rolling)
expect('normalizeUsage 把 150 夹到 100', !!usage && usage.weekly.percent === 100)
expect('normalizeUsage 把 -3 夹到 0', !!usage && usage.monthly.percent === 0)
expect('normalizeUsage 保留 resetsAt', !!usage && usage.rolling.resetsAt === '2026-11-11T13:26:23.000Z')
expect('normalizeUsage 对空输入返回 null', normalizeUsage(null) === null)

/* 4. 文档页解析：用一段和真实页面同结构的最小 HTML 验证。
 *    注意要保留真实页面里的换行：正则里的 .*? 不跨行，这是解析器能够
 *    只在一行内匹配的前提，拼成单行会让“模型名”吞掉整段表格。 */
const docsFixture = [
  '<table><thead><tr>',
  '<th>Model</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Monthly limit</th>',
  '</tr></thead><tbody>',
  '<tr><td><strong>DeepSeek V4.1 Flash</strong></td><td>$0.15</td><td>$0.60</td><td>$0.003</td><td>—</td><td>$100</td></tr>',
  '<tr><td><strong>Claude Haiku 5.5</strong></td><td>~~$30~~ $15</td><td>$75</td><td>—</td><td>—</td><td>~~$15~~ $60</td></tr>',
  '<tr><td><strong>Longcat 2.5 Free</strong></td><td>$0</td><td>$0</td><td>—</td><td>—</td><td>Unlimited</td></tr>',
  '</tbody></table>',
  '<table><thead><tr><th>Model</th><th>Model ID</th><th>Endpoint</th><th>AI SDK Package</th></tr></thead><tbody>',
  '<tr><td>DeepSeek V4.1 Flash</td><td>deepseek-v4.1-flash</td><td><code>https://opencode.ai/inference/go/openai/v1/chat/completions</code></td><td><code>@ai-sdk/openai-compatible</code></td></tr>',
  '<tr><td>Claude Haiku 5.5</td><td>claude-haiku-5-5</td><td><code>https://opencode.ai/inference/go/openai/v1/chat/completions</code></td><td><code>@ai-sdk/openai-compatible</code></td></tr>',
  '<tr><td>Longcat 2.5 Free</td><td>longcat-2.5-free</td><td><code>https://opencode.ai/inference/go/openai/v1/chat/completions</code></td><td><code>@ai-sdk/openai-compatible</code></td></tr>',
  '</tbody></table>',
].join('\n')

const limitsByName = parseLimitsTable(docsFixture)
expect('parseLimitsTable 读到 3 行', limitsByName.size === 3, `当前 ${limitsByName.size} 行`)
const idByName = parseModelIdTable(docsFixture)
expect('parseModelIdTable 读到 3 行', idByName.size === 3, `当前 ${idByName.size} 行`)
const docsLimits = parseDocsLimits(docsFixture)
expect('parseDocsLimits 拼出 3 个模型', !!docsLimits && Object.keys(docsLimits).length === 3)
expect('parseDocsLimits 认得 deepseek-v4.1-flash = 100', !!docsLimits && docsLimits['deepseek-v4.1-flash'] === 100)
expect('划价单元格取最后一个金额（$60）', !!docsLimits && docsLimits['claude-haiku-5-5'] === 60, JSON.stringify(docsLimits))
expect('Unlimited 记为 0', !!docsLimits && docsLimits['longcat-2.5-free'] === 0)
expect('两张表缺一张时返回 null', parseDocsLimits('<table></table>') === null)
expect('normalizeLimitName 会去掉版本号后缀', normalizeLimitName('DeepSeek V4.1 Flash 1017') === normalizeLimitName('DeepSeek V4.1 Flash'))

/* 5. provider 集合：OpenCode 两个、DeepSeek 一个，别互相串。 */
expect('OPENCODE_PROVIDERS 含 opencode-go', OPENCODE_PROVIDERS.includes('opencode-go'))
expect('OPENCODE_PROVIDERS 含 opencode', OPENCODE_PROVIDERS.includes('opencode'))
expect('DEEPSEEK_PROVIDERS 含 deepseek-official', DEEPSEEK_PROVIDERS.includes('deepseek-official'))

/* 6. 宿主与前端是否还接着这套逻辑。 */
const hostSource = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8')
expect('lib/index.js 导入了 ./opencode.js', hostSource.includes("from './opencode.js'"))
expect('lib/index.js 有信任判定 rejectUntrusted', hostSource.includes('rejectUntrusted'))
expect('lib/index.js 的 state.json 返回 opencode 字段', hostSource.includes('opencode: opencodeSection'))
expect('lib/index.js 监听 model/selection 事件', hostSource.includes("'model/selection'"))

const clientSource = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8')
expect('lib/client.js 使用 nt-oc 结构', clientSource.includes('nt-oc'))
expect('lib/client.js 读取 route.mode', clientSource.includes("route.mode === 'opencode-go'"))
expect('lib/client.js 会格式化百分比', clientSource.includes('formatPercent'))
expect('lib/client.js 会格式化重置倒计时', clientSource.includes('formatReset'))

const themeSource = fs.readFileSync(path.join(root, 'lib/theme.css'), 'utf8')
expect('lib/theme.css 有 .nt-oc 样式', themeSource.includes('.nt-oc {'))
expect('lib/theme.css 有超高用量告警色', themeSource.includes('.nt-oc-item.nt-hot b'))

if (problems.length > 0) {
  console.error('OpenCode Go 自检失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(
  `OpenCode Go 自检通过：内置额度表 ${builtinIds.length} 个模型，三档换算 20/50/100，文档解析与前端结构齐备。`,
)
