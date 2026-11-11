/**
 * dsh-nitai-theme 的宿主半区。
 *
 * 这个插件做四件事：
 *   1. 在页面 <body> 开头注入一段 <style>，把拟态主题的令牌与组件覆盖带进界面；
 *   2. 注册 /dsh-nitai-theme/client.js，让浏览器半区负责顶部刘海与交互；
 *   3. 监听会话里的模型用量事件，自己累计当前会话和当天的费用；
 *   4. 注册 /dsh-nitai-theme/state.json，把费用、峰谷和余额交给刘海显示。
 *
 * 注入通过 webserver/index-inject 完成，因此不依赖客户端构建。样式放在 body
 * 而不是 head，是为了让它排在本体所有样式表之后，普通规则也能覆盖本体样式。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { PRICING_REVISION, beijingDay, usageCost, usageTokens, windowInfo } from './pricing.js'
import {
  BUILTIN_MONTHLY_LIMITS,
  DEEPSEEK_PROVIDERS,
  LIMITS_CACHE_FILE,
  LIMITS_TTL_MS,
  OPENCODE_PROVIDERS,
  USAGE_FAILURE_TTL_MS,
  USAGE_TTL_MS,
  deriveLimitTiers,
  fetchDocsLimits,
  fetchModels,
  fetchUsage,
} from './opencode.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PREFIX = '/dsh-nitai-theme'
const STYLE_ID = 'nitai-theme-css'
const VERSION = '0.2.0'

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

const USAGE_DIR = path.join(os.homedir(), '.dsh', 'nitai-theme')
const USAGE_FILE = path.join(USAGE_DIR, 'usage.json')
const COSTNOTCH_LEDGER = path.join(os.homedir(), '.dsh', 'cost-notch', 'ledger.json')
const SESSIONS_DIR = path.join(os.homedir(), '.dsh', 'sessions')

/*
 * 额度缓存放在 DSH 的 logs 目录里，和 dsh-model-surplus 的做法一致：
 * 换一个 DSH_HOME（比如隔离测试实例）时缓存也跟着换，不会串数据。
 */
const DSH_HOME = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  ? process.env.DSH_HOME.trim()
  : path.join(os.homedir(), '.dsh')
const LOGS_DIR = path.join(DSH_HOME, 'logs')
const LIMITS_CACHE_PATH = path.join(LOGS_DIR, LIMITS_CACHE_FILE)

/*
 * 会话事件日志里每一行都是一个独立的 zstd 帧。这里按 zstd 的帧头魔数把文件切开，
 * 逐帧解压后统计 assistant/message 的用量；这样可以把 cost-notch 停用后漏记的
 * 同一会话费用补回来，又不需要依赖外部 zstd 命令。
 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const sessionLogPaths = new Map()
const sessionScanCache = new Map()

/* 金额统一换成 1e-8 元的整数再累加，避免很多次很小的加法出现浮点误差。 */
const SCALE = 1e8

let cachedThemeCss = null
let usage = null
let usageSaveTimer = null
let balanceCache = null
let balanceInFlight = null

const BALANCE_TTL_MS = 60 * 1000

/*
 * 每个会话当前用的是哪个 provider / 模型。刘海的展示模式要靠它切换：
 * OpenCode Go 的订阅显示额度百分比，DeepSeek 官方显示今日费用与账户余额。
 * 键是会话 id，另外保留一份「最后一次见到的路由」，给还没有任何事件的新会话兜底。
 */
const sessionRoutes = new Map()
let lastRoute = null

/* 上游请求的缓存：成功 2 分钟、失败 30 秒，多个页面同时打开时共用同一个请求。 */
let usageCache = null
let limitsCache = null
let modelsCache = null
let defaultRouteCache = null

const DEFAULT_ROUTE_TTL_MS = 10 * 1000
const MODELS_TTL_MS = 24 * 60 * 60 * 1000

function toUnits(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const units = Math.round(n * SCALE)
  return Number.isSafeInteger(units) ? units : 0
}

function fromUnits(units) {
  return Number(units) / SCALE
}

function emptyUsage(day) {
  return { day, todayUnits: 0, sessions: Object.create(null) }
}

/**
 * 第一次安装时，从 dsh-cost-notch 的账本里抄一份历史数据。
 *
 * 为什么要抄：用户可能已经用了很久，刚装上主题时刘海上不该从 0 开始。
 * 只抄一次；之后本插件自己记账，避免和 cost-notch 同时运行时重复累加。
 */
function seedFromCostNotch(day) {
  const seeded = emptyUsage(day)
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(COSTNOTCH_LEDGER, 'utf8'))
  } catch (err) {
    return seeded
  }
  if (!raw || typeof raw !== 'object') return seeded

  try {
    const accounts = raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {}
    const preferred = raw.accountKeys && accounts[raw.accountKeys]
    const account = preferred || Object.values(accounts).find((item) => item && item.days && item.days[day])
    const today = account && account.days && account.days[day]
    if (today && Number.isFinite(Number(today.spentUnits))) {
      seeded.todayUnits = Math.max(0, Math.trunc(Number(today.spentUnits)))
    }
  } catch (err) {
    /* 账本结构变了就只保留能读出来的部分。 */
  }

  try {
    const sessions = raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {}
    const entries = Object.entries(sessions)
      .filter(([, item]) => item && Number.isFinite(Number(item.cost)))
      .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0))
      .slice(0, 200)
    for (const [sid, item] of entries) {
      seeded.sessions[sid] = {
        costUnits: toUnits(item.cost),
        tokens: Number(item.tokens) || 0,
        turns: Number(item.turns) || 0,
        updatedAt: Number(item.updatedAt) || 0,
        title: typeof item.title === 'string' ? item.title : '',
        lastTurn: null,
      }
    }
  } catch (err) {
    /* 同上，坏掉的会话条目直接跳过。 */
  }
  return seeded
}

function normalizeUsage(raw, day) {
  const next = emptyUsage(day)
  if (!raw || typeof raw !== 'object') return next
  next.day = typeof raw.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : day
  next.todayUnits = Number.isFinite(Number(raw.todayUnits)) ? Math.max(0, Math.trunc(Number(raw.todayUnits))) : 0
  const sessions = raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {}
  for (const [sid, item] of Object.entries(sessions)) {
    if (!item || typeof item !== 'object') continue
    next.sessions[sid] = {
      costUnits: Number.isFinite(Number(item.costUnits)) ? Math.max(0, Math.trunc(Number(item.costUnits))) : 0,
      tokens: Number(item.tokens) || 0,
      turns: Number(item.turns) || 0,
      updatedAt: Number(item.updatedAt) || 0,
      title: typeof item.title === 'string' ? item.title : '',
      lastTurn: item.lastTurn === null || item.lastTurn === undefined ? null : Number(item.lastTurn),
      backfilled: item.backfilled === true,
    }
  }
  return next
}

function loadUsage() {
  const day = beijingDay()
  let fromFile = null
  try {
    fromFile = normalizeUsage(JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')), day)
  } catch (err) {
    fromFile = null
  }
  const fromLedger = seedFromCostNotch(day)
  if (!fromFile) return fromLedger

  /*
   * 两份数据取较大值，而不是相加：本插件可能和 cost-notch 同时记同一笔费用，
   * 相加会双倍；只取较大值可以让任何一方先记到的最新数字都能显示出来。
   */
  if (fromFile.day !== day) {
    fromFile.day = day
    fromFile.todayUnits = 0
  }
  fromFile.todayUnits = Math.max(fromFile.todayUnits, fromLedger.todayUnits)
  for (const [sid, item] of Object.entries(fromLedger.sessions)) {
    const current = fromFile.sessions[sid]
    if (!current || (item.updatedAt || 0) > (current.updatedAt || 0)) {
      fromFile.sessions[sid] = item
    }
  }
  return fromFile
}

function usageNow() {
  if (!usage) usage = loadUsage()
  return usage
}

function ensureDay(at) {
  const current = usageNow()
  const day = beijingDay(at)
  if (current.day !== day) {
    current.day = day
    current.todayUnits = 0
  }
  return current
}

function flushUsage() {
  if (usageSaveTimer) {
    clearTimeout(usageSaveTimer)
    usageSaveTimer = null
  }
  const current = usageNow()
  try {
    fs.mkdirSync(USAGE_DIR, { recursive: true })
    const tmp = `${USAGE_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({
      version: 1,
      day: current.day,
      todayUnits: current.todayUnits,
      sessions: current.sessions,
    }), 'utf8')
    fs.renameSync(tmp, USAGE_FILE)
  } catch (err) {
    /* 写盘失败不影响页面，下一次事件还会再试。 */
  }
}

function saveUsageSoon() {
  if (usageSaveTimer) return
  usageSaveTimer = setTimeout(() => {
    usageSaveTimer = null
    flushUsage()
  }, 1200)
  if (typeof usageSaveTimer.unref === 'function') usageSaveTimer.unref()
}

function sessionView(sid) {
  if (!sid) return null
  const current = usageNow()
  const item = current.sessions[sid]
  if (!item) return null
  return {
    sessionId: sid,
    cost: fromUnits(item.costUnits),
    tokens: item.tokens,
    turns: item.turns,
    updatedAt: item.updatedAt,
    title: item.title || '',
  }
}

function recordUsage(sessionId, event, data) {
  if (!data || typeof data.usage !== 'object' || !data.usage) return
  const at = Number(event.time) || Date.now()
  const current = ensureDay(at)
  const source = data.message && data.message.source ? data.message.source : null
  const model = source && source.model ? source.model : ''
  if (source && typeof source.provider === 'string') noteRoute(sessionId, source.provider, model)
  const priced = usageCost(data.usage, model, at)
  const item = current.sessions[sessionId] || {
    costUnits: 0, tokens: 0, turns: 0, updatedAt: 0, title: '', lastTurn: null, backfilled: false,
  }
  item.costUnits += toUnits(priced.amount)
  item.tokens += usageTokens(data.usage)
  const turn = Number(data.turn)
  if (Number.isFinite(turn) && item.lastTurn !== turn) {
    item.turns += 1
    item.lastTurn = turn
  }
  item.updatedAt = at
  current.todayUnits += toUnits(priced.amount)
  current.sessions[sessionId] = item
  saveUsageSoon()
}

function findSessionLog(sid) {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(sid || ''))) return null
  if (sessionLogPaths.has(sid)) return sessionLogPaths.get(sid)
  let found = null
  try {
    for (const entry of fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(SESSIONS_DIR, entry.name, sid, 'session.v4.jsonl.zstd')
      if (fs.existsSync(candidate)) {
        found = candidate
        break
      }
    }
  } catch (err) {
    found = null
  }
  sessionLogPaths.set(sid, found)
  return found
}

/*
 * 读一个会话的事件日志，把所有 assistant/message 的用量按同一套价格表重新算一遍。
 * 结果按文件的修改时间和大小缓存，日志追加后会自动重算。
 */
function scanSessionLog(sid) {
  const file = findSessionLog(sid)
  if (!file) return null
  let stat
  try {
    stat = fs.statSync(file)
  } catch (err) {
    return null
  }
  const cached = sessionScanCache.get(sid)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.result

  let buffer
  try {
    buffer = fs.readFileSync(file)
  } catch (err) {
    return null
  }
  const offsets = []
  let cursor = 0
  while (cursor < buffer.length) {
    const found = buffer.indexOf(ZSTD_MAGIC, cursor)
    if (found < 0) break
    offsets.push(found)
    cursor = found + ZSTD_MAGIC.length
  }
  let amount = 0
  let tokens = 0
  let updatedAt = 0
  let createdAt = 0
  let route = null
  const turns = new Set()
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index]
    const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length
    let chunk
    try {
      chunk = zlib.zstdDecompressSync(buffer.subarray(start, end))
    } catch (err) {
      continue
    }
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue
      let event
      try {
        event = JSON.parse(line)
      } catch (err) {
        continue
      }
      if (!event || event.type !== 'assistant/message' || !event.data || !event.data.usage) {
        if (event && event.type === 'session') createdAt = Number(event.createdAt) || 0
        /* 选模型事件带着 provider 和模型名，用它就能判断该显示哪种额度。 */
        if (event && event.type === 'model/selection' && event.data) {
          const provider = event.data.provider
          if (typeof provider === 'string' && provider) {
            route = { provider, model: typeof event.data.model === 'string' ? event.data.model : '' }
          }
        }
        continue
      }
      const source = event.data.message && event.data.message.source
      if (source && typeof source.provider === 'string' && source.provider) {
        route = { provider: source.provider, model: typeof source.model === 'string' ? source.model : '' }
      }
      const at = Number(event.time) || 0
      const priced = usageCost(event.data.usage, '', at)
      if (!Number.isFinite(priced.amount)) continue
      amount += priced.amount
      tokens += usageTokens(event.data.usage)
      updatedAt = Math.max(updatedAt, at)
      const turn = Number(event.data.turn)
      if (Number.isFinite(turn)) turns.add(turn)
    }
  }
  const result = { amount, tokens, turns: turns.size, updatedAt, createdAt, route }
  sessionScanCache.set(sid, { mtimeMs: stat.mtimeMs, size: stat.size, result })
  return result
}

/*
 * 把日志里算出来的费用并进账本。只做“取较大值”，所以重复调用不会累加；
 * 第一次补一个旧账本已经记过一部分的会话时，把差额补进今天，避免历史被少算。
 */
function backfillSession(sid) {
  if (!sid) return
  const scanned = scanSessionLog(sid)
  if (!scanned || !(scanned.amount > 0)) return
  const current = ensureDay(Date.now())
  let item = current.sessions[sid]
  if (!item) {
    current.sessions[sid] = {
      costUnits: toUnits(scanned.amount),
      tokens: scanned.tokens,
      turns: scanned.turns,
      updatedAt: scanned.updatedAt,
      title: '',
      lastTurn: null,
      backfilled: true,
    }
    saveUsageSoon()
    return
  }
  const stored = fromUnits(item.costUnits)
  if (scanned.amount > stored + 1e-7) {
    const deltaUnits = toUnits(scanned.amount) - toUnits(stored)
    item.costUnits = toUnits(scanned.amount)
    item.tokens = Math.max(item.tokens, scanned.tokens)
    item.turns = Math.max(item.turns, scanned.turns)
    item.updatedAt = Math.max(item.updatedAt, scanned.updatedAt)
    if (beijingDay(scanned.createdAt) === current.day) current.todayUnits += deltaUnits
    item.backfilled = true
    saveUsageSoon()
  } else {
    item.backfilled = true
  }
}

/**
 * 读 DeepSeek 账号余额。没有登录、接口没准备好或调用失败时都返回失败对象，
 * 刘海会把余额一格留空，不影响费用和峰谷显示。
 */
async function readBalance(ctx, force) {
  if (!force && balanceCache && Date.now() - balanceCache.at < BALANCE_TTL_MS) {
    return balanceCache.payload
  }
  if (balanceInFlight) return balanceInFlight
  balanceInFlight = (async () => {
    const fail = (code, error) => ({ ok: false, code, error })
    let account
    try {
      account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null
    } catch (err) {
      account = null
    }
    if (!account || typeof account.getBalance !== 'function') return fail('NO_ACCOUNT', '账号余额服务不可用')
    let result
    try {
      result = await account.getBalance({
        version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
        locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      })
    } catch (err) {
      return fail('ACCOUNT_CALL_FAILED', String((err && err.message) || err).slice(0, 160))
    }
    if (!result) return fail('NOT_SIGNED_IN', '未登录 DeepSeek 账号')
    if (result.status !== 'ready') return fail('NOT_READY', String(result.status || 'unknown'))
    const wallets = [...(Array.isArray(result.value) ? result.value : []), ...(Array.isArray(result.bonusWallets) ? result.bonusWallets : [])]
      .filter((wallet) => wallet && Number.isFinite(Number(wallet.balance)))
    if (wallets.length === 0) return fail('NO_WALLETS', '账号没有余额钱包')
    const currencies = wallets.map((wallet) => String(wallet.currency || 'CNY').toUpperCase())
    const positive = (wallet) => Number(wallet.balance) > 0
    const pick = wallets.find((wallet, index) => positive(wallet) && currencies[index] === 'CNY')
      || wallets.find((wallet) => positive(wallet))
      || wallets[0]
    const currency = currencies[wallets.indexOf(pick)]
    const amount = wallets
      .filter((wallet, index) => currencies[index] === currency)
      .reduce((sum, wallet) => sum + Number(wallet.balance), 0)
    return {
      ok: true,
      amount: Number(amount.toFixed(6)),
      currency,
      source: 'account',
      updatedAt: Date.now(),
    }
  })()
  try {
    const payload = await balanceInFlight
    balanceCache = { at: Date.now(), payload }
    return payload
  } finally {
    balanceInFlight = null
  }
}

/**
 * 记下某个会话当前用的 provider 与模型。
 *
 * 为什么只在内存里记：路由变化很频繁（用户随时切模型），落盘没有意义，
 * 重启后第一次请求会从会话日志里重新读出来，读不到再退回默认模型。
 */
function noteRoute(sid, provider, model) {
  if (typeof provider !== 'string' || !provider) return
  const route = {
    provider,
    model: typeof model === 'string' ? model : '',
    at: Date.now(),
  }
  if (sid) sessionRoutes.set(sid, route)
  lastRoute = route
}

/**
 * 从 settings 服务里读某个配置项的值。
 *
 * DSH 0.2 起只提供 describe()：它按命名空间返回配置项，每项带 ns、value、
 * secrets 等字段（密钥已被抹掉），命名空间名就是 profile 里写的插件 id，
 * 例如 agent-default-model。读不到就返回 null，调用方自己决定怎么兜底。
 */
function describeValue(ctx, id) {
  try {
    const settings = typeof ctx.get === 'function' ? ctx.get('settings') : null
    if (!settings || typeof settings.describe !== 'function') return null
    const descriptors = settings.describe({ redactSecrets: true })
    if (!Array.isArray(descriptors)) return null
    const entry = descriptors.find((item) => item && (item.ns === id || item.id === id || item.name === id))
    return entry && entry.value && typeof entry.value === 'object' ? entry.value : null
  } catch (err) {
    return null
  }
}

/**
 * 读「默认模型」配置，给还没有任何模型事件的空白会话兜底。
 * 结果缓存 10 秒，避免每个轮询都走一遍 describe()。
 */
function readDefaultRoute(ctx) {
  const now = Date.now()
  if (defaultRouteCache && now - defaultRouteCache.at < DEFAULT_ROUTE_TTL_MS) {
    return defaultRouteCache.route
  }
  const value = describeValue(ctx, 'agent-default-model')
  const provider = value && typeof value.provider === 'string' ? value.provider : ''
  const model = value && typeof value.model === 'string' ? value.model : ''
  const route = provider ? { provider, model, at: now } : null
  defaultRouteCache = { at: now, route }
  return route
}

/**
 * 判断一个会话当前走的是哪条路由。
 *
 * 顺序是：实时事件 → 会话日志里最后一条选模型记录 → 全局默认模型 → 最后见到的路由。
 * 前两步靠得住；后两步只是为了让空白会话也有东西可显示，不会太离谱。
 */
function readRoute(ctx, sid) {
  if (sid && sessionRoutes.has(sid)) return sessionRoutes.get(sid)
  if (sid) {
    const scanned = scanSessionLog(sid)
    if (scanned && scanned.route) {
      noteRoute(sid, scanned.route.provider, scanned.route.model)
      return sessionRoutes.get(sid) || scanned.route
    }
  }
  const fallback = readDefaultRoute(ctx) || lastRoute
  if (fallback) {
    if (!fallback.at) fallback.at = Date.now()
    return fallback
  }
  return null
}

/** 展示模式：OpenCode Go 订阅、DeepSeek 官方、其它（沿用费用视图）。 */
function routeMode(route) {
  if (!route) return 'cost'
  if (OPENCODE_PROVIDERS.includes(route.provider)) return 'opencode-go'
  if (DEEPSEEK_PROVIDERS.includes(route.provider)) return 'deepseek'
  return 'cost'
}

/**
 * 找出这条路由用哪个环境变量名存密钥。
 *
 * 先读 llm-pi-ai 的 providers[provider].apiKeyEnv（引擎实际鉴权用的就是它），
 * 读不到再按 provider 名字猜惯用名。全部候选都要试一遍，因为用户可能只配了其中一个。
 */
function credentialRefs(ctx, provider) {
  const refs = []
  const llm = describeValue(ctx, 'llm-pi-ai')
  const providers = llm && typeof llm.providers === 'object' ? llm.providers : null
  const env = providers && providers[provider] ? providers[provider].apiKeyEnv : null
  if (typeof env === 'string' && env.trim()) refs.push(env.trim())
  if (provider === 'opencode') refs.push('OPENCODE_API_KEY', 'OPENCODE_GO_API_KEY')
  else refs.push('OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY')
  return [...new Set(refs.filter((ref) => typeof ref === 'string' && ref))]
}

/**
 * 依次尝试候选密钥名，返回第一个能解析出非空值的密钥，全部失败返回 null。
 * 解析失败（比如这个名没配）不能中断搜索，否则后面的候选永远不会被检查。
 */
async function resolveApiKey(ctx, provider) {
  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : null
  if (!credentials || typeof credentials.resolve !== 'function') return null
  for (const ref of credentialRefs(ctx, provider)) {
    try {
      const resolved = await credentials.resolve(ref)
      const value = resolved && resolved.value
      if (typeof value === 'string' && value) return value
    } catch (err) {
      /* 换下一个候选名。 */
    }
  }
  return null
}

/**
 * 取 OpenCode Go 用量。成功缓存 2 分钟，失败缓存 30 秒，并发请求共用一次上游调用。
 * 缓存是为了：多个窗口同时打开、页面每 60 秒轮询一次，都不会把上游打成筛子。
 */
async function readOpencodeUsage(ctx, provider) {
  const now = Date.now()
  if (usageCache && !usageCache.inflight) {
    const ttl = usageCache.value && usageCache.value.ok ? USAGE_TTL_MS : USAGE_FAILURE_TTL_MS
    if (now - usageCache.at < ttl) return usageCache.value
  }
  if (usageCache && usageCache.inflight) return usageCache.inflight

  const run = (async () => {
    const apiKey = await resolveApiKey(ctx, provider)
    if (!apiKey) return { ok: false, reason: 'no-key' }
    return fetchUsage({ apiKey })
  })()
  usageCache = { at: now, value: null, inflight: run }
  try {
    const value = await run
    usageCache = { at: Date.now(), value, inflight: null }
    return value
  } catch (err) {
    const value = { ok: false, reason: 'network' }
    usageCache = { at: Date.now(), value, inflight: null }
    return value
  }
}

/** 读额度缓存文件；文件不存在或格式不对都返回 null。 */
function readLimitsCacheFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LIMITS_CACHE_PATH, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.limits || typeof parsed.limits !== 'object') return null
    if (typeof parsed.fetchedAt !== 'string') return null
    return { limits: parsed.limits, fetchedAt: parsed.fetchedAt }
  } catch (err) {
    return null
  }
}

/** 把额度表写到缓存文件里；写失败不影响显示。 */
function writeLimitsCacheFile(payload) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
    fs.writeFileSync(LIMITS_CACHE_PATH, JSON.stringify(payload), 'utf8')
    return true
  } catch (err) {
    return false
  }
}

/**
 * 取每个模型的月度额度：先看内存缓存，再看磁盘缓存，最后才去文档页解析。
 * 三条路都失败时退回内置表，并在返回值里标出数据来源，方便界面提示「参考值」。
 */
async function readLimits(ctx) {
  const now = Date.now()
  if (limitsCache && now - limitsCache.at < LIMITS_TTL_MS) return limitsCache

  const cached = readLimitsCacheFile()
  if (cached && now - Date.parse(cached.fetchedAt) < LIMITS_TTL_MS) {
    limitsCache = { limits: cached.limits, fetchedAt: cached.fetchedAt, source: 'docs-cache', at: now }
    return limitsCache
  }

  const fetched = await fetchDocsLimits({})
  if (fetched.ok) {
    writeLimitsCacheFile({ limits: fetched.limits, fetchedAt: fetched.fetchedAt })
    limitsCache = { limits: fetched.limits, fetchedAt: fetched.fetchedAt, source: 'docs', at: now }
    return limitsCache
  }

  limitsCache = { limits: BUILTIN_MONTHLY_LIMITS, fetchedAt: null, source: 'builtin', at: now }
  return limitsCache
}

/** 读公开模型清单（显示名、上下文长度）。失败返回 null，界面就只显示模型 id。 */
async function readModels() {
  const now = Date.now()
  if (modelsCache && now - modelsCache.at < MODELS_TTL_MS) return modelsCache.value
  const fetched = await fetchModels({})
  const value = fetched.ok ? fetched.models : null
  modelsCache = { at: now, value }
  return value
}

/**
 * 组装 OpenCode Go 这一段数据：
 *   - usage：三档百分比与重置时间（来自用量接口，账户级）；
 *   - model：当前模型 id、显示名、上下文长度；
 *   - windows：当前模型的三档美元额度；
 *   - limitsSource / limitsUpdatedAt：额度表从哪来、什么时候取的。
 */
async function readOpencodeSection(ctx, route) {
  const [usage, limits, models] = await Promise.all([
    readOpencodeUsage(ctx, route.provider),
    readLimits(ctx),
    readModels(),
  ])

  const modelId = route.model || ''
  const monthly = Object.prototype.hasOwnProperty.call(limits.limits, modelId)
    ? limits.limits[modelId]
    : null
  const info = models && models[modelId] ? models[modelId] : null

  return {
    ok: !!(usage && usage.ok),
    reason: usage && usage.ok ? null : (usage && usage.reason) || 'network',
    usage: usage && usage.ok ? usage.usage : null,
    fetchedAt: usage && usage.ok ? usage.fetchedAt : null,
    model: {
      id: modelId,
      name: info ? info.name : modelId,
      context: info ? info.context : null,
      monthlyLimit: monthly,
      unlimited: monthly === 0,
    },
    windows: Number.isFinite(monthly) ? deriveLimitTiers(monthly) : null,
    limitsSource: limits.source,
    limitsUpdatedAt: limits.fetchedAt,
  }
}

/**
 * 判断这个请求是不是可信的页面发出的。
 *
 * webServer 注册的路由对任何本机调用者都会应答，而 state.json 里有余额和费用，
 * 所以必须向 connection 服务要一个判定：它返回 undefined 表示放行，返回 401/403
 * 表示已经拒绝。拿不到 connection 服务时默认拒绝（宁可少显示一次，也不要把
 * 余额交给来路不明的进程）。
 */
function rejectUntrusted(ctx, req, res) {
  const connection = typeof ctx.get === 'function' ? ctx.get('connection') : null
  if (!connection || typeof connection.requestRejection !== 'function') {
    sendText(res, 403, TEXT_HEADERS, 'forbidden')
    return true
  }
  let rejection
  try {
    rejection = connection.requestRejection(req)
  } catch (err) {
    sendText(res, 403, TEXT_HEADERS, 'forbidden')
    return true
  }
  if (rejection === undefined) return false
  sendText(res, rejection, TEXT_HEADERS, rejection === 401 ? 'unauthorized' : 'forbidden')
  return true
}

/**
 * 读取主题 CSS。文件可能在开发中被反复修改，所以每次按修改时间判断是否需要
 * 重新读盘；返回的字符串里如果出现 </style，会先拆开，避免提前结束样式标签。
 *
 * 样式由 theme.css 和 layout-fix.css 组成：theme.css 里有一份宽表规则的兼容
 * 副本，layout-fix.css 始终接在后面。这样旧宿主能继续用 theme.css，新宿主
 * 也不会因为主题升级把副本冲掉而丢掉修复；以后往 layout-fix.css 加规则也
 * 不需要改 theme.css。
 */
function readThemeCss() {
  const files = [
    path.join(HERE, 'theme.css'),
    path.join(HERE, 'layout-fix.css'),
  ]
  try {
    const entries = files.map((file) => {
      try {
        const stat = fs.statSync(file)
        return { file, mtimeMs: stat.mtimeMs, size: stat.size }
      } catch (err) {
        return null
      }
    })
    const stamp = entries
      .map((entry, index) => (entry ? `${entry.file}:${entry.mtimeMs}:${entry.size}` : `${files[index]}:missing`))
      .join('|')
    if (cachedThemeCss && cachedThemeCss.stamp === stamp) {
      return cachedThemeCss.text
    }
    const themeText = entries[0] ? fs.readFileSync(entries[0].file, 'utf8') : ''
    const fixText = entries[1] ? fs.readFileSync(entries[1].file, 'utf8') : ''
    /*
     * layout-fix.css 始终接在 theme.css 后面。theme.css 里的那份副本只是给
     * 还在运行的旧宿主兜底；两份规则相同，重复不会改变结果。以后往
     * layout-fix.css 里加新的布局修正时，不需要再动 theme.css。
     */
    const text = `${themeText}\n${fixText}`.replace(/<\/style/gi, '<\\/style')
    cachedThemeCss = { stamp, text }
    return text
  } catch (err) {
    return cachedThemeCss ? cachedThemeCss.text : ''
  }
}

/** 浏览器半区文件的内容，用于 /client.js 路由。 */
function readClientJs() {
  try {
    return fs.readFileSync(path.join(HERE, 'client.js'), 'utf8')
  } catch (err) {
    return ''
  }
}

/** 给某个资源加一个版本号，文件一改，页面就会重新拉取。 */
function revisionOf(relative) {
  try {
    const stat = fs.statSync(path.join(HERE, relative))
    return `${stat.size}-${Math.round(stat.mtimeMs)}`
  } catch (err) {
    return '0'
  }
}

function sendText(res, status, headers, body) {
  res.writeHead(status, headers)
  res.end(body)
}

function sendJson(res, status, payload) {
  sendText(res, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }, JSON.stringify(payload))
}

export default {
  name: 'dsh-nitai-theme',

  apply(root) {
    /*
     * 注入行必须同步登记：桌面外壳只在启动时收集一次注入表，晚于服务握手再
     * 订阅就会错过这一轮。这里先登记，再用 root.inject 处理路由。
     */
    const rowDisposers = []
    root.effect(() => () => {
      for (const dispose of rowDisposers) {
        try { dispose() } catch (err) { /* 卸载时忽略单个订阅的报错 */ }
      }
      flushUsage()
    })

    rowDisposers.push(root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        const css = readThemeCss()

        /* 同一份注入表里已经有主题样式时不再追加，避免热重载后出现两份。 */
        const cssAlreadyThere = table.some((row) =>
          row && row.kind === 'html' && typeof row.html === 'string' && row.html.includes(`id="${STYLE_ID}"`))
        if (!cssAlreadyThere && css) {
          table.push({
            kind: 'html',
            placement: 'body',
            html: `<style id="${STYLE_ID}">${css}</style>`,
          })
        }

        const clientUrl = `${PREFIX}/client.js?v=${revisionOf('client.js')}`
        const scriptAlreadyThere = table.some((row) =>
          row && row.kind === 'script-src' && row.src === clientUrl)
        if (!scriptAlreadyThere) {
          table.push({ kind: 'script-src', placement: 'body', src: clientUrl })
        }
      } catch (err) {
        /* 注入失败不应该影响页面启动；下一次渲染还会再试。 */
      }
    }))

    root.inject(['webServer'], (ctx) => {
      const disposers = []
      ctx.effect(() => () => {
        for (const dispose of disposers) {
          try { dispose() } catch (err) { /* 卸载时忽略单个路由的报错 */ }
        }
      })

      /*
       * 会话事件挂在 webServer 的注入上下文里，和 dsh-cost-notch 的做法保持一致：
       * 这个上下文已经拿到宿主服务，收到的事件才是完整的会话事件。
       */
      disposers.push(ctx.on('session/event', (session, event) => {
        try {
          if (!event || typeof event !== 'object') return
          const sid = session && session.id ? String(session.id) : 'default'
          const data = event.data && typeof event.data === 'object' ? event.data : null
          if (!data) return
          if (event.type === 'model/selection') {
            noteRoute(sid, data.provider, data.model)
            return
          }
          if (event.type === 'assistant/message') {
            recordUsage(sid, event, data)
            return
          }
          if (event.type === 'session/title' && typeof data.title === 'string' && data.title) {
            const current = ensureDay(Number(event.time) || Date.now())
            const item = current.sessions[sid] || {
              costUnits: 0, tokens: 0, turns: 0, updatedAt: 0, title: '', lastTurn: null, backfilled: false,
            }
            item.title = data.title
            item.updatedAt = Number(event.time) || Date.now()
            current.sessions[sid] = item
            saveUsageSoon()
          }
        } catch (err) {
          /* 单个事件解析失败不能影响会话本身。 */
        }
      }))

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/client.js`,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendText(res, 405, TEXT_HEADERS, 'method not allowed')
            return
          }
          const body = readClientJs()
          if (!body) {
            sendText(res, 404, TEXT_HEADERS, 'client.js not found')
            return
          }
          sendText(res, 200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          }, body)
        },
      }))

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/theme.css`,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendText(res, 405, TEXT_HEADERS, 'method not allowed')
            return
          }
          const body = readThemeCss()
          if (!body) {
            sendText(res, 404, TEXT_HEADERS, 'theme.css not found')
            return
          }
          sendText(res, 200, {
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          }, body)
        },
      }))

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/state.json`,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendText(res, 405, TEXT_HEADERS, 'method not allowed')
            return
          }
          if (rejectUntrusted(ctx, req, res)) return
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const sid = String(url.searchParams.get('session') || '')
          const now = Date.now()
          const current = ensureDay(now)
          backfillSession(sid)

          const route = readRoute(ctx, sid)
          const mode = routeMode(route)

          /*
           * 只有走 OpenCode Go 时才会去请求上游用量；DeepSeek 官方模式下不发这次
           * 请求，省一次网络往返，也避免把 OpenCode 的额度显示在别人的界面上。
           */
          const opencode = mode === 'opencode-go' && route
            ? readOpencodeSection(ctx, route).catch(() => null)
            : Promise.resolve(null)

          const balance = mode === 'deepseek'
            ? readBalance(ctx, false).catch(() => null)
            : Promise.resolve(null)

          Promise.all([opencode, balance]).then(([opencodeSection, balanceValue]) => {
            sendJson(res, 200, {
              ok: true,
              now,
              day: current.day,
              window: windowInfo(now),
              route: route
                ? { provider: route.provider, model: route.model, mode }
                : { provider: '', model: '', mode: 'cost' },
              opencode: opencodeSection,
              balance: balanceValue && balanceValue.ok
                ? { ok: true, amount: balanceValue.amount, currency: balanceValue.currency, source: balanceValue.source, updatedAt: balanceValue.updatedAt }
                : { ok: false, code: balanceValue && balanceValue.code, error: balanceValue && balanceValue.error },
              today: { day: current.day, currency: 'CNY', spent: fromUnits(current.todayUnits) },
              session: sessionView(sid),
              pricing: { revision: PRICING_REVISION },
            })
          }).catch(() => {
            sendJson(res, 200, {
              ok: true,
              now,
              day: current.day,
              window: windowInfo(now),
              route: route
                ? { provider: route.provider, model: route.model, mode }
                : { provider: '', model: '', mode: 'cost' },
              opencode: null,
              balance: { ok: false, code: 'BALANCE_FAILED' },
              today: { day: current.day, currency: 'CNY', spent: fromUnits(current.todayUnits) },
              session: sessionView(sid),
              pricing: { revision: PRICING_REVISION },
            })
          })
        },
      }))

      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: `${PREFIX}/health`,
        handler: (req, res) => {
          /* 这个接口会带出今日花费和路由，和 state.json 一样只给可信页面看。 */
          if (rejectUntrusted(ctx, req, res)) return
          const current = usageNow()
          sendJson(res, 200, {
            ok: true,
            plugin: 'dsh-nitai-theme',
            version: VERSION,
            cssBytes: readThemeCss().length,
            clientBytes: readClientJs().length,
            usageDay: current.day,
            usageSessions: Object.keys(current.sessions).length,
            usageSpent: fromUnits(current.todayUnits),
            pricingRevision: PRICING_REVISION,
            route: lastRoute ? `${lastRoute.provider}/${lastRoute.model}` : null,
            opencode: usageCache && usageCache.value
              ? { ok: !!usageCache.value.ok, reason: usageCache.value.reason || null, at: usageCache.at }
              : null,
            limits: limitsCache ? { source: limitsCache.source, models: Object.keys(limitsCache.limits).length } : null,
          })
        },
      }))
    })
  },
}
