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

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PREFIX = '/dsh-nitai-theme'
const STYLE_ID = 'nitai-theme-css'
const VERSION = '0.1.0'

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
  const model = (data.message && data.message.source && data.message.source.model) || ''
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
        continue
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
  const result = { amount, tokens, turns: turns.size, updatedAt, createdAt }
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
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const sid = String(url.searchParams.get('session') || '')
          const now = Date.now()
          const current = ensureDay(now)
          backfillSession(sid)
          readBalance(ctx, false).then((balance) => {
            sendJson(res, 200, {
              ok: true,
              now,
              day: current.day,
              window: windowInfo(now),
              balance: balance && balance.ok
                ? { ok: true, amount: balance.amount, currency: balance.currency, source: balance.source, updatedAt: balance.updatedAt }
                : { ok: false, code: balance && balance.code, error: balance && balance.error },
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
          })
        },
      }))
    })
  },
}
