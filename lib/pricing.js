/**
 * DeepSeek pricing, peak/valley (峰谷) window, and CNY cost arithmetic.
 *
 * Facts verified 2026-10-09 against the official pages:
 *   - https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 *   - https://api-docs.deepseek.com/zh-cn/updates
 *   - 2026 holiday arrangement: 国办发明电〔2025〕7号 (www.gov.cn)
 *
 * Official rule (pricing page footnote):
 *   "空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）
 *    9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日
 *    全天均为空闲时段。"
 *   → peak = Mon–Fri (excluding statutory holidays) 09:00–12:00 & 14:00–18:00 CST;
 *     everything else — weekends and holidays all day — is off-peak.
 *   → 调休 makeup-work weekends are still weekends ⇒ still off-peak all day.
 *
 * Prices are CNY per 1,000,000 tokens as [off-peak, peak].
 * Money is accumulated in integer 1e-8 units (see money.js) so repeated
 * additions of small per-step costs stay exact.
 */

export const PRICING_REVISION = '2026-10-09'

/** Peak windows, in Beijing local hours, as [startHour, endHour) pairs. */
export const PEAK_HOURS = [
  [9, 12],
  [14, 18],
]

/** Flash (deepseek-flash = DeepSeek-V4.1-Flash). */
const FLASH = { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }
/**
 * Pro (deepseek-v4-pro). Not a uniform multiple of Flash: after the 2026-09-10
 * Flash price cut the Pro/Flash ratios are 7.5x (cache hit), 4.5x (cache miss)
 * and 3.375x (output).
 */
const PRO = { hit: [0.15, 0.3], miss: [4.5, 9.0], out: [13.5, 27.0] }

/**
 * Built-in price table, matched by longest-first substring against the model id.
 * `_default` is the fallback for an unknown model.
 */
export const BUILTIN_PRICES = {
  'deepseek-flash': FLASH,
  'deepseek-v4-flash': FLASH,
  'deepseek-v4-flash-vision-exp': FLASH,
  'deepseek-v4-pro': PRO,
  _default: FLASH,
}

/* ------------------------------------------------------------------ *
 * Peak / valley
 * ------------------------------------------------------------------ */

/** Beijing calendar day (YYYY-MM-DD) for an epoch-ms instant. */
export function beijingDay(time = Date.now()) {
  const d = new Date(Number(time) + 8 * 3600000)
  if (!Number.isFinite(d.getTime())) throw new Error('invalid observation time')
  return d.toISOString().slice(0, 10)
}

/** Epoch-ms of Beijing midnight for the day containing `time`. */
export function beijingDayStart(time = Date.now()) {
  const d = new Date(Number(time) + 8 * 3600000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600000
}

/**
 * Announced holiday periods (放假安排). A date listed here is off-peak all day.
 *
 * 2026 is official (国办发明电〔2025〕7号). Only dates that would otherwise be
 * peak (Mon–Fri) actually change the answer, but the full announced periods are
 * listed because DeepSeek's own "中秋国庆十天全半价" covers the whole 放假 period.
 *
 * 2027 is NOT yet published (the State Council notice normally lands in early
 * November of the preceding year). The entries below are the strictly-statutory
 * dates derived from 《全国年节及纪念日放假办法》(Order 795) plus the lunar
 * calendar, i.e. a deliberately conservative fallback. Replace with the official
 * arrangement once it is published, and widen `HOLIDAYS` accordingly.
 */
export const HOLIDAYS = {
  2026: [
    '2026-01-01', '2026-01-02', '2026-01-03', // 元旦
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
    '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23', // 春节
    '2026-04-04', '2026-04-05', '2026-04-06', // 清明
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', // 劳动节
    '2026-06-19', '2026-06-20', '2026-06-21', // 端午
    '2026-09-25', '2026-09-26', '2026-09-27', // 中秋
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
    '2026-10-06', '2026-10-07', // 国庆
  ],
  2027: [
    '2027-01-01', // 元旦
    '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', // 春节（除夕…初三）
    '2027-04-05', // 清明
    '2027-05-01', '2027-05-02', // 劳动节
    '2027-06-09', // 端午
    '2027-09-15', // 中秋
    '2027-10-01', '2027-10-02', '2027-10-03', // 国庆
  ],
}

const HOLIDAY_SET = new Set()
for (const list of Object.values(HOLIDAYS)) for (const day of list) HOLIDAY_SET.add(day)
/** Highest year for which an official arrangement is known to be loaded. */
const OFFICIAL_HOLIDAY_YEARS = new Set([2026])

export function isHoliday(day) {
  return HOLIDAY_SET.has(day)
}

/** True when the loaded holiday table for `day`'s year is provisional. */
export function holidaysProvisional(day) {
  return !OFFICIAL_HOLIDAY_YEARS.has(Number(String(day).slice(0, 4)))
}

/**
 * Whether an instant bills at peak rates.
 * @param {number} timeSec epoch seconds (or ms; values > 1e12 are treated as ms)
 */
export function isPeak(timeSec) {
  const n = Number(timeSec)
  if (!Number.isFinite(n)) return false
  const ms = n > 1e12 ? n : n * 1000
  const bj = new Date(ms + 8 * 3600000)
  const dow = bj.getUTCDay() // 0 = Sunday, 6 = Saturday (reading the shifted date in UTC = Beijing calendar)
  if (dow === 0 || dow === 6) return false // weekends — including 调休 makeup workdays — are off-peak all day
  if (isHoliday(bj.toISOString().slice(0, 10))) return false // statutory holiday all day
  const hour = bj.getUTCHours()
  for (const [start, end] of PEAK_HOURS) if (hour >= start && hour < end) return true
  return false
}

/**
 * Epoch-ms of the next peak/valley switch strictly after `time`.
 * Scans Beijing hour boundaries plus midnight, up to 30 days out (the longest
 * Chinese holiday period is 9 days, so 30 leaves ample room).
 * @returns {number|null} null when no switch is found in the scan window
 */
export function nextPeakChangeAt(time = Date.now()) {
  const n = Number(time)
  if (!Number.isFinite(n)) return null
  const cur = isPeak(n)
  const edges = [0, ...PEAK_HOURS.map(([s]) => s), ...PEAK_HOURS.map(([, e]) => e)]
  const day0 = beijingDayStart(n)
  for (let d = 0; d <= 30; d++) {
    for (const edge of edges) {
      const cand = day0 + d * 86400000 + edge * 3600000
      if (cand <= n + 1) continue
      if (isPeak(cand) !== cur) return cand
    }
  }
  return null
}

/** Describe the current billing window. */
export function windowInfo(time = Date.now()) {
  const peak = isPeak(time)
  const nextAt = nextPeakChangeAt(time)
  return {
    peak,
    label: peak ? '高峰' : '谷时',
    nextChangeAt: nextAt,
    nextPeak: nextAt === null ? null : !peak,
    holidayToday: isHoliday(beijingDay(time)),
    provisional: holidaysProvisional(beijingDay(time)),
  }
}

/* ------------------------------------------------------------------ *
 * Cost
 * ------------------------------------------------------------------ */

/** Longest-first substring match, so a short key cannot shadow a longer one. */
function matchPrice(table, model) {
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (key === '_default') continue
    if (key && m.includes(key.toLowerCase())) return table[key]
  }
  return null
}

/**
 * Resolve the price entry for a model, honouring user overrides.
 * @param {string} model model id from the assistant message source
 * @param {Record<string, {hit:number[],miss:number[],out:number[]}>} [overrides]
 */
export function priceFor(model, overrides) {
  if (overrides && typeof overrides === 'object') {
    const custom = matchPrice(overrides, model)
    if (custom && Array.isArray(custom.hit) && Array.isArray(custom.miss) && Array.isArray(custom.out)) {
      return custom
    }
  }
  return matchPrice(BUILTIN_PRICES, model) || BUILTIN_PRICES._default
}

/** Billed input tokens = uncached input + cache hits (cache writes bill as misses). */
export function billedInput(usage) {
  const input = Number(usage && usage.inputTokens) || 0
  const cacheRead = Number(usage && usage.cacheReadTokens) || 0
  const cacheWrite = Number(usage && usage.cacheWriteTokens) || 0
  return { input, cacheRead, cacheWrite, uncached: input + cacheWrite }
}

/**
 * Cost in CNY for one usage sample.
 *
 * `inputTokens` counts uncached input only in DSH's own accounting
 * (`billedInputTokens(usage) === usage.inputTokens + cacheWriteTokens`), while
 * `cacheReadTokens` is the cache-hit share — so the two are disjoint.
 * `reasoningTokens` is a subset of `outputTokens` (dsh-token-meter rejects
 * reasoning > output), so it must NOT be billed again on top of output.
 */
export function usageCost(usage, model, at = Date.now(), overrides) {
  const { input, cacheRead, cacheWrite } = billedInput(usage)
  const output = Number(usage && usage.outputTokens) || 0
  const p = priceFor(model, overrides)
  const off = isPeak(at) ? 1 : 0
  const uncached = input + cacheWrite
  const cost =
    (cacheRead / 1e6) * p.hit[off] +
    (uncached / 1e6) * p.miss[off] +
    (output / 1e6) * p.out[off]
  return {
    amount: Number.isFinite(cost) ? cost : 0,
    tokens: input + cacheRead + cacheWrite + output,
    breakdown: { input: uncached, cacheRead, cacheWrite, output },
    peak: off === 1,
    model: String(model || ''),
  }
}

/** Token total for a usage sample (the number DSH's own usage pill shows). */
export function usageTokens(usage) {
  const { input, cacheRead, cacheWrite } = billedInput(usage)
  return input + cacheRead + cacheWrite + (Number(usage && usage.outputTokens) || 0)
}

/** Cache-hit share, as a 0–100 integer, or null when there is no input at all. */
export function cacheHitPercent(usage) {
  const { input, cacheRead, cacheWrite } = billedInput(usage)
  const total = input + cacheRead + cacheWrite
  if (total <= 0) return null
  return Math.round((cacheRead / total) * 100)
}
