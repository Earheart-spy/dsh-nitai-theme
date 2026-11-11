/*
 * OpenCode Go 的用量与额度数据。
 *
 * 这个文件只做三件事，都不依赖 DSH 运行时，方便用 node 直接跑测试：
 *   1. 请求账户级用量接口，把它整理成「5 小时 / 本周 / 本月」三档百分比；
 *   2. 请求公开的模型清单接口，拿到模型显示名与上下文长度；
 *   3. 尽力从公开文档页里读出「每月额度」表，读不到就退回内置表。
 *
 * 为什么额度要另外解析：OpenCode Go 的用量接口只返回百分比，不返回美元额度，
 * 而每个模型的月度额度并不相同（DeepSeek V4.1 Flash 是 $100，Claude Haiku 5.5 是 $15），
 * 所以「还剩多少额度」这句话只能靠文档里的额度表换算出来。
 */

/** 走 OpenCode Go 订阅的 provider 标识；两个名字是同一个服务的不同写法。 */
export const OPENCODE_PROVIDERS = ['opencode-go', 'opencode']

/**
 * DeepSeek 官方 provider，沿用主题原来的「今日 / 会话 / 余额」展示。
 *
 * 这里列了三种写法：deepseek-official 是内置的官方直连，deepseek-account 是
 * 账号体系里选出来的官方路由（本机隔离 profile 的默认模型就是它），deepseek
 * 是早期配置里出现过的简写。三者都走余额接口。
 */
export const DEEPSEEK_PROVIDERS = ['deepseek-official', 'deepseek-account', 'deepseek']

/** 用量接口；文档里写的推理入口是 /inference/go/v1，用量入口在 /zen/go/v1。 */
export const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

/** 公开模型清单，不需要密钥，返回每个模型的价格、上下文长度与显示名。 */
export const MODELS_URL = 'https://opencode.ai/inference/go/v1/models'

/** 公开文档页；「每月额度」表只存在这里。 */
export const DOCS_URL = 'https://opencode.ai/docs/console/go/'

/** 用量与额度的缓存文件名，放在 <DSH_HOME>/logs 下。 */
export const LIMITS_CACHE_FILE = 'nitai-theme-opencode-limits.json'

/** 缓存多久刷新一次：用量要看得见变化，额度一天变一次就够。 */
export const USAGE_TTL_MS = 120_000
export const USAGE_FAILURE_TTL_MS = 30_000
export const LIMITS_TTL_MS = 24 * 60 * 60 * 1000

/** 上游请求的超时与响应体上限，防止被篡改的上游把内存塞满。 */
export const REQUEST_TIMEOUT_MS = 10_000
export const MAX_BODY_BYTES = 2 * 1024 * 1024
export const MAX_DOCS_BYTES = 512 * 1024

/**
 * 内置的月度额度表，单位是美元，键是 OpenCode 的模型 id。
 *
 * 数据抄自 2026-11-11 的公开文档「每月额度」表（Go 档）。额度为 0 表示该模型
 * 不限量。文档解析成功时会用解析结果覆盖这张表，所以它只是网络不通时的兜底。
 */
export const BUILTIN_MONTHLY_LIMITS = {
  'glm-5.3-flash': 60,
  'glm-5.3': 15,
  'glm-5.2': 60,
  'kimi-k3.1-pro': 15,
  'kimi-k3': 15,
  'kimi-k2.7-code': 60,
  'longcat-2.0': 60,
  'step-5-preview': 15,
  'beam-free': 0,
  'iceman-contributor-free': 0,
  'longcat-2.5-free': 0,
  'mimo-v2.6-flash': 60,
  'mimo-v2.6-pro': 15,
  'mimo-v2.5': 60,
  'mimo-v2.5-pro': 15,
  'minimax-m3.1-flash': 20,
  'minimax-m3': 60,
  'muse-spark-1.3-contributor': 60,
  'muse-spark-1.2-contributor': 60,
  'qwen3.8-max': 15,
  'qwen3.8-flash': 30,
  'qwen3.7-plus': 60,
  'deepseek-v4.1-flash': 100,
  'deepseek-v4-pro': 15,
  hy4: 60,
  'hy4-preview': 30,
  hy3: 60,
  'grok-4.7': 15,
  'gpt-6-luna': 15,
  'gpt-5.6-luna': 15,
  'claude-haiku-5-5': 15,
  'gemini-4-argon': 30,
}

/** 把一个模型的月度额度换算成三档：5 小时 20%、本周 50%、本月 100%。 */
export function deriveLimitTiers(monthly) {
  const round1 = (value) => Math.round(value * 10) / 10
  return { hours5: round1(monthly * 0.2), weekly: round1(monthly * 0.5), monthly }
}

/** 把「月额度」表换算成「模型 id → 三档额度」。 */
export function deriveLimits(monthlyLimits) {
  const out = {}
  for (const [id, monthly] of Object.entries(monthlyLimits || {})) {
    /* 缓存文件是外部数据，原型链上的键不能当成模型 id 写进结果。 */
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue
    if (Number.isFinite(monthly) && monthly >= 0) out[id] = deriveLimitTiers(monthly)
  }
  return out
}

/**
 * 把用量接口的一档数据整理成 { status, percent, resetsAt }。
 * 百分比夹在 0 到 100 之间，避免上游给出离谱数字时进度条被拉爆。
 */
export function normalizeBucket(raw) {
  if (!raw || typeof raw !== 'object') return null
  const percent = Number(raw.percent)
  if (!Number.isFinite(percent)) return null
  return {
    status: typeof raw.status === 'string' && raw.status ? raw.status : 'ok',
    percent: Math.min(100, Math.max(0, percent)),
    resetsAt: typeof raw.resetsAt === 'string' && raw.resetsAt ? raw.resetsAt : null,
  }
}

/** 整理整个用量响应；三档一个都认不出来时返回 null。 */
export function normalizeUsage(body) {
  const usage = body && typeof body === 'object' ? body.usage : null
  if (!usage || typeof usage !== 'object') return null
  const out = {}
  for (const key of ['rolling', 'weekly', 'monthly']) {
    const bucket = normalizeBucket(usage[key])
    if (bucket) out[key] = bucket
  }
  return Object.keys(out).length > 0 ? out : null
}

/** 模型显示名归一化：去掉括号里的档位说明与末尾版本号，只留字母数字。 */
export function normalizeLimitName(name) {
  return String(name || '')
    .replace(/\([^)]*\)/gu, ' ')
    .replace(/\b\d{3,4}\b/gu, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '')
}

/**
 * 从文档页里读出「模型名 → 每月额度」。
 *
 * 表格结构是：模型 | 输入价 | 输出价 | 缓存读 | 缓存写 | 每月额度。
 * 额度单元格里可能带促销文字（例如「~~$15~~ $60」），取最后一个美元金额；
 * 「Unlimited」记成 0，表示不限量。
 */
export function parseLimitsTable(html) {
  const out = new Map()
  const head = html.indexOf('Monthly limit</th>')
  if (head < 0) return out
  const end = html.indexOf('</tbody></table>', head)
  if (end < 0 || end <= head) return out
  const body = html.slice(head, Math.min(end, head + MAX_DOCS_BYTES))

  let at = 0
  for (;;) {
    const rowStart = body.indexOf('<tr>', at)
    if (rowStart < 0) break
    const rowEnd = body.indexOf('</tr>', rowStart)
    if (rowEnd < 0) break
    const row = body.slice(rowStart + 4, rowEnd)
    at = rowEnd + 5

    const cells = []
    let cellAt = 0
    while (cells.length < 6) {
      const cellStart = row.indexOf('<td>', cellAt)
      if (cellStart < 0) break
      const cellEnd = row.indexOf('</td>', cellStart + 4)
      if (cellEnd < 0) break
      cells.push(row.slice(cellStart + 4, cellEnd))
      cellAt = cellEnd + 5
    }
    if (cells.length < 6) continue

    const rawName = cells[0].replace(/<[^>]+>/gu, '').trim()
    const base = rawName.replace(/\s*\(.*\)\s*$/u, '').trim()
    if (!base) continue

    const cell = cells[5].replace(/<[^>]+>/gu, ' ').trim()
    if (/unlimited/iu.test(cell)) {
      out.set(normalizeLimitName(base), 0)
      continue
    }
    const dollars = [...cell.matchAll(/\$(\d+(?:\.\d+)?)/gu)].map((hit) => Number(hit[1]))
    const monthly = dollars.length > 0 ? dollars[dollars.length - 1] : null
    if (monthly === null || !Number.isFinite(monthly) || monthly < 0) continue
    if (!out.has(normalizeLimitName(base))) out.set(normalizeLimitName(base), monthly)
  }
  return out
}

/**
 * 从文档页里读出「模型名 → 模型 id」。
 *
 * 文档里的「端点」表有三列：模型、模型 ID、端点地址。端点地址换过一次
 * （早期是 /zen/go/v1/…，现在是 /inference/go/…），所以只要求出现
 * opencode.ai 加一段 /go/ 路径，不写死具体形态。
 */
export function parseModelIdTable(html) {
  const out = new Map()
  const pattern = /<tr><td>(.*?)<\/td><td>([a-z0-9][a-z0-9.-]*)<\/td><td><code[^>]*>https:\/\/opencode\.ai\/[^<]*\/go\/[^<]*<\/code>/gu
  for (const match of html.matchAll(pattern)) {
    const name = match[1].replace(/<[^>]+>/gu, '').trim()
    if (!name) continue
    const key = normalizeLimitName(name)
    if (!out.has(key)) out.set(key, match[2])
  }
  return out
}

/**
 * 把「额度表」和「模型 id 表」拼成 { 模型 id: 月额度 }。
 * 两张表任何一张读不出来就返回 null，让调用方退回内置表。
 */
export function parseDocsLimits(html) {
  const limitsByName = parseLimitsTable(html)
  const idByName = parseModelIdTable(html)
  if (limitsByName.size === 0 || idByName.size === 0) return null
  const limits = {}
  for (const [key, monthly] of limitsByName) {
    const id = idByName.get(key)
    if (id !== undefined) limits[id] = monthly
  }
  return Object.keys(limits).length > 0 ? limits : null
}

/**
 * 整理公开模型清单，得到 { 模型 id: { name, context } }。
 * 清单里同一模型的显示名可能带版本号（例如「DeepSeek V4.1 Flash 1017」），原样保留。
 */
export function normalizeModels(body) {
  const list = body && Array.isArray(body.data) ? body.data : null
  if (!list) return null
  const out = {}
  for (const item of list) {
    if (!item || typeof item.id !== 'string' || !item.id) continue
    const context = item.limit && Number(item.limit.context)
    out[item.id] = {
      name: typeof item.name === 'string' && item.name ? item.name : item.id,
      context: Number.isFinite(context) && context > 0 ? context : null,
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

/** 读取最多 maxBytes 字节的响应体；超限返回 null，避免上游把内存塞满。 */
export async function readBodyCapped(res, maxBytes = MAX_BODY_BYTES) {
  if (!res || !res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text()
    return text.length > maxBytes ? null : text
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      try { await reader.cancel() } catch (err) { /* 取消失败不影响返回值 */ }
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
}

/**
 * 发一次 GET，把结果分成 { ok: true, body } 或 { ok: false, reason }。
 * reason 只会是 unauthorized / upstream / timeout / network / bad-payload 之一，
 * 客户端据此决定是提示「没配置密钥」还是「稍后重试」。
 */
export async function fetchJson({ url, apiKey, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = MAX_BODY_BYTES, log = () => {} }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = { accept: 'application/json' }
    if (typeof apiKey === 'string' && apiKey) headers.authorization = `Bearer ${apiKey}`
    const res = await fetchImpl(url, { headers, signal: controller.signal })
    if (!res.ok) {
      log('upstream rejected', res.status)
      return {
        ok: false,
        reason: res.status === 401 || res.status === 403 ? 'unauthorized' : 'upstream',
        status: res.status,
      }
    }
    const text = await readBodyCapped(res, maxBytes)
    if (text === null) return { ok: false, reason: 'bad-payload' }
    try {
      return { ok: true, body: JSON.parse(text) }
    } catch (err) {
      return { ok: false, reason: 'bad-payload' }
    }
  } catch (error) {
    const aborted = error && error.name === 'AbortError'
    log('upstream request failed', error && error.message ? error.message : String(error))
    return { ok: false, reason: aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** 取 OpenCode Go 用量；成功返回 { ok: true, usage, fetchedAt }。 */
export async function fetchUsage(options) {
  const result = await fetchJson({ ...options, url: options.url || USAGE_URL })
  if (!result.ok) return result
  const usage = normalizeUsage(result.body)
  if (!usage) return { ok: false, reason: 'bad-payload' }
  return { ok: true, usage, fetchedAt: new Date().toISOString() }
}

/** 取公开模型清单；失败时调用方按「没有显示名」处理。 */
export async function fetchModels(options) {
  const result = await fetchJson({ ...options, url: options.url || MODELS_URL })
  if (!result.ok) return result
  const models = normalizeModels(result.body)
  if (!models) return { ok: false, reason: 'bad-payload' }
  return { ok: true, models, fetchedAt: new Date().toISOString() }
}

/** 取文档页并解析月度额度；返回 { ok: true, limits } 或失败原因。 */
export async function fetchDocsLimits(options) {
  const url = options.url || DOCS_URL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS)
  try {
    const res = await (options.fetchImpl || fetch)(url, {
      headers: { accept: 'text/html' },
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, reason: 'upstream', status: res.status }
    const text = await readBodyCapped(res, MAX_DOCS_BYTES)
    if (text === null) return { ok: false, reason: 'bad-payload' }
    const limits = parseDocsLimits(text)
    if (!limits) return { ok: false, reason: 'bad-payload' }
    return { ok: true, limits, fetchedAt: new Date().toISOString() }
  } catch (error) {
    const aborted = error && error.name === 'AbortError'
    return { ok: false, reason: aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}
