/**
 * dsh-nitai-theme 的浏览器半区。
 *
 * 这里负责三件事：
 *   1. 在页面顶部挂一颗拟态胶囊（刘海），显示时间、星期、今日费用、本次会话费用；
 *   2. 点开面板后显示大时钟、农历、余额和三档明暗模式开关；
 *   3. 如果同一台机器还装着 dsh-cost-notch，就隐藏它原来的顶部条，并把它的
 *      齿轮入口接到面板里，避免两条横条叠在一起，也保留费用设置的去处。
 *
 * 这个文件是标准的 DSH 客户端模块（package.json 的 dsh.client 与 exports["./client"]），
 * 由页面里的 __ModuleLoader__ 注册后调用 apply()；Cordis 用它当插件对象的工厂，
 * 所以这里不写 import/export，而是把 apply 挂到返回的对象上。重复调用只挂载一次。
 */

window.__ModuleLoader__.load({
  id: 'dsh-nitai-theme',
  factory: () => {
    const exports = {}

    exports.name = 'dsh-nitai-theme'
    exports.inject = []
    exports.apply = function apply() {
      if (window.__dshNitaiThemeLoaded) return
      window.__dshNitaiThemeLoaded = true
      start()
    }

    return exports
  },
})

function start () {
  'use strict'

  var MODE_KEY = 'dsh-nitai-theme.mode'
  var MODE_COOKIE = 'nt_mode'
  var COST_URL = '/dsh-nitai-theme/state.json'
  var COST_FALLBACK = '/dsh-costnotch/state.json'
  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
  var LUNAR_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

  var SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4.2"></circle>' +
    '<path d="M12 2.6v2.1M12 19.3v2.1M4.7 4.7l1.5 1.5M17.8 17.8l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.7 19.3l1.5-1.5M17.8 6.2l1.5-1.5"></path>' +
    '</svg>'

  var MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20.2 14.4A8.5 8.5 0 0 1 9.6 3.8 8.6 8.6 0 1 0 20.2 14.4Z"></path>' +
    '</svg>'

  var CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m6 9 6 6 6-6"></path>' +
    '</svg>'

  var state = {
    mode: null,
    cost: null,
    panelOpen: false,
    mounted: false,
    costBusy: false,
  }

  var media = window.matchMedia('(prefers-color-scheme: dark)')
  var el = null
  var refs = {}
  var lunarFormatter = null
  var tickTimer = null
  var pollTimer = null
  var syncTimer = null

  function byRef(name) {
    return refs[name] || null
  }

  function isDarkMode() {
    return !!(document.body && document.body.hasAttribute('data-ds-dark-theme'))
  }

  /*
   * 桌面端每次启动都会换一个本地端口，localStorage 按“协议 + 主机 + 端口”隔离，
   * 换端口后就读不到上一次的选择。Cookie 只按主机隔离，所以这里再写一份 Cookie，
   * 让主题选择在换端口后仍然记得住。
   */
  function readCookieMode() {
    try {
      var pairs = String(document.cookie || '').split(';')
      for (var i = 0; i < pairs.length; i++) {
        var parts = pairs[i].split('=')
        if (parts[0].trim() !== MODE_COOKIE) continue
        var value = decodeURIComponent((parts[1] || '').trim())
        if (value === 'light' || value === 'dark' || value === 'auto') return value
      }
    } catch (err) {
      /* 读不到 Cookie 时退回跟随系统 */
    }
    return null
  }

  function readStoredMode() {
    try {
      var value = window.localStorage.getItem(MODE_KEY)
      if (value === 'light' || value === 'dark' || value === 'auto') return value
    } catch (err) {
      /* 隐私模式下读不到 localStorage，继续试 Cookie */
    }
    return readCookieMode()
  }

  function storeMode(mode) {
    try {
      window.localStorage.setItem(MODE_KEY, mode)
    } catch (err) {
      /* 隐私模式下写不进去也不影响这一次使用 */
    }
    try {
      document.cookie = MODE_COOKIE + '=' + encodeURIComponent(mode) + '; path=/; max-age=31536000; SameSite=Lax'
    } catch (err) {
      /* Cookie 被禁用时只保留本次会话内的选择 */
    }
  }

  function setDark(on) {
    if (!document.body) return
    if (on) document.body.setAttribute('data-ds-dark-theme', '')
    else document.body.removeAttribute('data-ds-dark-theme')
    syncIcons()
  }

  function applyMode(mode, persist) {
    state.mode = mode
    if (persist) storeMode(mode)
    if (mode === 'auto') setDark(media.matches)
    else setDark(mode === 'dark')
    syncSegments()
  }

  function syncIcons() {
    var button = byRef('theme')
    if (!button) return
    var dark = isDarkMode()
    button.innerHTML = dark ? SUN_SVG : MOON_SVG
    button.title = dark ? '切换到浅色模式' : '切换到深色模式'
    button.setAttribute('aria-label', button.title)
  }

  function syncSegments() {
    if (!el) return
    var effective = isDarkMode() ? 'dark' : 'light'
    var segments = el.querySelectorAll('[data-mode]')
    for (var i = 0; i < segments.length; i += 1) {
      var button = segments[i]
      var mode = button.getAttribute('data-mode')
      var pressed = state.mode === 'auto'
        ? mode === 'auto'
        : (state.mode ? mode === state.mode : mode === effective)
      button.setAttribute('aria-pressed', pressed ? 'true' : 'false')
    }
  }

  function two(n) {
    return n < 10 ? '0' + n : String(n)
  }

  function lunarDayName(day) {
    if (day === 10) return '初十'
    if (day === 20) return '二十'
    if (day === 30) return '三十'
    if (day < 10) return '初' + LUNAR_DIGITS[day - 1]
    if (day < 20) return '十' + LUNAR_DIGITS[day - 11]
    if (day < 30) return '廿' + LUNAR_DIGITS[day - 21]
    return String(day)
  }

  function lunarText(date) {
    try {
      if (!lunarFormatter) {
        lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
          month: 'long',
          day: 'numeric',
        })
      }
      var parts = lunarFormatter.formatToParts(date)
      var month = ''
      var day = 0
      for (var i = 0; i < parts.length; i += 1) {
        if (parts[i].type === 'month') month = parts[i].value
        if (parts[i].type === 'day') day = Number(parts[i].value)
      }
      if (month && day > 0) return month + lunarDayName(day)
      return lunarFormatter.format(date)
    } catch (err) {
      return ''
    }
  }

  function tick() {
    var now = new Date()
    var time = two(now.getHours()) + ':' + two(now.getMinutes())
    var weekday = '星期' + WEEKDAYS[now.getDay()]

    if (byRef('time')) byRef('time').textContent = time
    if (byRef('weekday')) byRef('weekday').textContent = weekday
    if (byRef('bigtime')) byRef('bigtime').textContent = time
    if (byRef('bigdate')) {
      byRef('bigdate').textContent = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日'
    }
    if (byRef('daynum')) byRef('daynum').textContent = two(now.getDate())
    if (byRef('month')) byRef('month').textContent = (now.getMonth() + 1) + '月'

    var lunar = lunarText(now)
    if (byRef('lunar')) byRef('lunar').textContent = lunar ? '农历 ' + lunar : weekday

    renderWindow()

    /*
     * OpenCode Go 模式下，面板里的“剩 2 时 20 分”也要跟着走秒。
     * 这里每秒重画一次统计区，重画代价只有十几次文本赋值，不会引起重排。
     */
    if (state.cost && state.cost.route && state.cost.route.mode === 'opencode-go') renderCost()

    /* 页面如果被整体替换过，把刘海补回去，交互绑定仍然在同一个节点上。 */
    if (el && !el.isConnected && document.body) document.body.appendChild(el)
  }

  function isNumber(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  }

  function formatMoney(value) {
    if (!isNumber(value)) return '—'
    var number = Number(value)
    return '¥' + number.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  /* 面板里的三格统计：值写在各自的 <b> 里，外层卡片只负责凹槽和空值样式。 */
  function setStat(name, value, options) {
    var stat = byRef(name)
    if (!stat) return
    var opts = options || {}
    var label = stat.querySelector('span')
    var node = stat.querySelector('b') || stat
    var note = stat.querySelector('em')
    if (label && opts.label) label.textContent = opts.label
    node.textContent = opts.format ? opts.format(value) : formatMoney(value)
    if (note) {
      note.textContent = opts.note || ''
      note.hidden = !opts.note
    }
    stat.classList.toggle('nt-stat-empty', !isNumber(value) && !opts.note)
  }

  /* 百分比只保留整数，省得刘海里出现 13.4% 这种长度不稳定的数字。 */
  function formatPercent(value) {
    if (!isNumber(value)) return '—'
    return Math.round(Number(value)) + '%'
  }

  /* 上下文长度换成“万”：1000000 → 100 万，128000 → 12.8 万。 */
  function formatContext(value) {
    if (!isNumber(value) || Number(value) <= 0) return ''
    var wan = Number(value) / 10000
    var text = wan >= 100 ? String(Math.round(wan)) : String(Math.round(wan * 10) / 10)
    return text + ' 万'
  }

  /* 额度重置时间：给“剩 2 时 20 分”这种一眼能懂的倒计时，没有时间就给空串。 */
  function formatReset(iso) {
    if (!iso) return ''
    var at = Date.parse(iso)
    if (!Number.isFinite(at)) return ''
    var left = at - Date.now()
    if (left <= 0) return '即将重置'
    var minutes = Math.ceil(left / 60000)
    if (minutes < 60) return '剩 ' + minutes + ' 分'
    var hours = Math.floor(minutes / 60)
    if (hours < 24) {
      var rest = minutes % 60
      return '剩 ' + hours + ' 时' + (rest ? ' ' + rest + ' 分' : '')
    }
    return '剩 ' + Math.floor(hours / 24) + ' 天'
  }

  /* 用量取不到时，把原因翻成人话；界面只给一句，不弹错误框。 */
  function opencodeReason(opencode) {
    var reason = opencode && opencode.reason
    if (reason === 'no-key') return '未配置 OpenCode 密钥'
    if (reason === 'unauthorized') return 'OpenCode 密钥无效'
    if (reason === 'timeout' || reason === 'network') return '用量接口暂时连不上'
    if (reason === 'bad-payload') return '用量数据格式异常'
    if (reason === 'upstream') return '用量接口返回错误'
    return ''
  }

  /* 把毫秒差转成一眼能读完的倒计时：超过一小时给“X时Y分”，不足一小时给“Y分”，最后一分钟给“X秒”。 */
  function formatEta(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return ''
    var totalSeconds = Math.ceil(ms / 1000)
    if (totalSeconds < 60) return totalSeconds + '秒'
    var minutes = Math.floor(totalSeconds / 60)
    if (minutes < 60) return minutes + '分'
    var hours = Math.floor(minutes / 60)
    var rest = minutes % 60
    return hours + '时' + (rest ? rest + '分' : '')
  }

  /* 峰谷状态来自费用插件的 window 字段；没装费用插件时不显示这一格，不占位置。 */
  function renderWindow() {
    var chip = byRef('window')
    if (!chip) return
    /*
     * OpenCode Go 是订阅额度制，没有“高峰/谷时”这种按时段计价的概念，
     * 这一格在那边没有意义，直接隐藏，避免让人以为还在按 DeepSeek 的峰谷计费。
     */
    var ocMode = !!(state.cost && state.cost.route && state.cost.route.mode === 'opencode-go')
    var info = ocMode ? null : state.cost && state.cost.peakWindow
    if (!info) {
      chip.hidden = true
      return
    }
    chip.hidden = false
    var peak = !!info.peak
    chip.classList.toggle('is-peak', peak)
    var label = info.label || (peak ? '高峰' : '谷时')
    if (byRef('winLabel')) byRef('winLabel').textContent = label
    var nextAt = Number(info.nextChangeAt)
    var eta = Number.isFinite(nextAt) ? formatEta(nextAt - Date.now()) : ''
    if (byRef('winEta')) {
      byRef('winEta').textContent = eta
      byRef('winEta').hidden = !eta
    }
    chip.title = label + (eta ? ' · 还有 ' + eta : '')
  }

  /*
   * 刘海有两种展示模式，选哪个由宿主返回的 route.mode 决定：
   * - opencode-go：当前会话走 OpenCode Go，收起态显示 5 小时 / 本周 / 本月 三个用量百分比，
   *   面板三格也换成这三个百分比，并在下面补一行模型名、月额度和重置倒计时。
   * - deepseek（以及其它情况）：保持原来的“今日 / 会话 / 余额”金额模式。
   */
  function renderCost() {
    var cost = state.cost || {}
    var opencode = cost.opencode || null
    var route = cost.route || null
    var ocMode = !!(route && route.mode === 'opencode-go')
    var usage = opencode && opencode.usage ? opencode.usage : null
    var reason = ocMode ? opencodeReason(opencode) : ''

    if (byRef('cost')) byRef('cost').hidden = ocMode || !(isNumber(cost.today) || isNumber(cost.session) || isNumber(cost.balance))
    if (byRef('costSep')) byRef('costSep').hidden = ocMode || byRef('cost').hidden
    if (byRef('oc')) byRef('oc').hidden = !ocMode
    if (byRef('ocSep')) byRef('ocSep').hidden = !ocMode

    if (!ocMode) {
      var hasCost = isNumber(cost.today) || isNumber(cost.session) || isNumber(cost.balance)
      if (hasCost) {
        if (byRef('today')) byRef('today').textContent = formatMoney(cost.today)
        if (byRef('session')) byRef('session').textContent = formatMoney(cost.session)
        if (byRef('balance')) byRef('balance').textContent = formatMoney(cost.balance)
      }
      if (byRef('balanceItem')) byRef('balanceItem').hidden = !isNumber(cost.balance)
      setStat('statToday', cost.today, { label: '今日' })
      setStat('statSession', cost.session, { label: '本次会话' })
      setStat('statBalance', cost.balance, { label: '余额' })
      if (byRef('ocMeta')) byRef('ocMeta').hidden = true
      renderWindow()
      return
    }

    /* OpenCode Go 模式：三个百分比 chip，超过 85% 变橙、达到 100% 变红。 */
    var buckets = [
      { ref: 'ocRolling', item: 'ocRollingItem', bucket: usage && usage.rolling },
      { ref: 'ocWeekly', item: 'ocWeeklyItem', bucket: usage && usage.weekly },
      { ref: 'ocMonthly', item: 'ocMonthlyItem', bucket: usage && usage.monthly },
    ]
    for (var i = 0; i < buckets.length; i += 1) {
      var entry = buckets[i]
      var percent = entry.bucket ? entry.bucket.percent : null
      if (byRef(entry.ref)) byRef(entry.ref).textContent = formatPercent(percent)
      if (byRef(entry.item)) {
        byRef(entry.item).classList.toggle('nt-hot', isNumber(percent) && Number(percent) >= 85)
        byRef(entry.item).classList.toggle('nt-full', isNumber(percent) && Number(percent) >= 100)
        byRef(entry.item).title = entry.bucket && entry.bucket.resetsAt
          ? formatReset(entry.bucket.resetsAt)
          : ''
      }
    }

    var rollingNote = usage && usage.rolling ? formatReset(usage.rolling.resetsAt) : ''
    var weeklyNote = usage && usage.weekly ? formatReset(usage.weekly.resetsAt) : ''
    var monthlyNote = usage && usage.monthly ? formatReset(usage.monthly.resetsAt) : ''
    setStat('statToday', usage && usage.rolling ? usage.rolling.percent : null, {
      label: '5 小时',
      format: formatPercent,
      note: rollingNote || reason,
    })
    setStat('statSession', usage && usage.weekly ? usage.weekly.percent : null, {
      label: '本周',
      format: formatPercent,
      note: weeklyNote,
    })
    setStat('statBalance', usage && usage.monthly ? usage.monthly.percent : null, {
      label: '本月',
      format: formatPercent,
      note: monthlyNote,
    })

    if (byRef('ocMeta')) {
      var meta = []
      if (opencode && opencode.model) {
        var model = opencode.model
        meta.push(model.name || model.id)
        if (model.unlimited) meta.push('月额度不限')
        else if (isNumber(model.monthlyLimit)) meta.push('月额度 $' + model.monthlyLimit)
        var context = formatContext(model.context)
        if (context) meta.push('上下文 ' + context)
      }
      if (opencode && opencode.limitsSource === 'builtin') meta.push('额度表为内置参考值')
      byRef('ocMeta').textContent = meta.join(' · ')
      byRef('ocMeta').hidden = meta.length === 0
    }

    /* OpenCode 模式下“费用设置”指向的是 DeepSeek 计费的设置，留着只会让人误会，直接藏起来。 */
    if (byRef('costSettings')) byRef('costSettings').hidden = true
    renderWindow()
  }

  function currentSessionId() {
    var node = document.querySelector('[data-conversation-session]')
    if (node) {
      var id = node.getAttribute('data-conversation-session')
      if (id) return id
    }
    var match = window.location.hash.match(/session[=/]([A-Za-z0-9_-]+)/)
    return match ? match[1] : ''
  }

  function mockCost() {
    var mock = window.__NT_MOCK_COST__
    if (!mock) return null
    try {
      return typeof mock === 'function' ? mock() : mock
    } catch (err) {
      return null
    }
  }

  function requestCost(baseUrl) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null
    /*
     * 超时放宽到 8 秒：OpenCode Go 的用量要走一次上游请求，冷启动时 4 秒可能不够，
     * 太短会让刘海误判成“接口挂了”。宿主侧上游本身还有 10 秒超时。
     */
    var timer = controller ? window.setTimeout(function () { controller.abort() }, 8000) : null
    var url = baseUrl + '?session=' + encodeURIComponent(currentSessionId())
    return fetch(url, { cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then(function (data) {
        if (timer) window.clearTimeout(timer)
        return data
      }, function (err) {
        if (timer) window.clearTimeout(timer)
        throw err
      })
  }

  function refreshCost() {
    var mock = mockCost()
    if (mock) {
      state.cost = mock
      renderCost()
      return
    }
    if (state.costBusy) return
    state.costBusy = true

    /*
     * 优先读本插件自己记的账。这样即使 dsh-cost-notch 被停用，费用也能更新。
     * 如果主题宿主路由暂时不可用，再退回 cost-notch 的旧接口。
     */
    requestCost(COST_URL)
      .catch(function () { return requestCost(COST_FALLBACK) })
      .then(function (data) {
        state.cost = {
          today: data && data.today ? data.today.spent : null,
          session: data && data.session ? data.session.cost : null,
          balance: data && data.balance ? data.balance.amount : null,
          currency: (data && data.balance && data.balance.currency) || 'CNY',
          peakWindow: data && data.window ? data.window : null,
          route: (data && data.route) || null,
          opencode: (data && data.opencode) || null,
        }
      })
      .catch(function () {
        /* 两个接口都取不到时，刘海只显示时间和主题按钮，不报错。 */
        state.cost = null
      })
      .then(function () {
        state.costBusy = false
        renderCost()
      })
  }

  function syncCostNotch() {
    var costNotch = document.querySelector('.dshcn-notch')
    var gear = document.querySelector('.dshcn-n-gear')
    var ocMode = !!(state.cost && state.cost.route && state.cost.route.mode === 'opencode-go')
    if (document.body) document.body.classList.toggle('nt-has-costbar', !!costNotch)
    /* OpenCode Go 模式下不显示“费用设置”，那个开关管的是 DeepSeek 的计费展示。 */
    if (byRef('costSettings')) byRef('costSettings').hidden = ocMode || !gear
  }

  function setOpen(open) {
    state.panelOpen = !!open
    if (!el) return
    el.classList.toggle('nt-open', state.panelOpen)
    if (byRef('panel')) byRef('panel').setAttribute('aria-hidden', state.panelOpen ? 'false' : 'true')
    if (byRef('more')) byRef('more').setAttribute('aria-expanded', state.panelOpen ? 'true' : 'false')
    if (state.panelOpen) {
      tick()
      refreshCost()
      syncCostNotch()
    }
  }

  function markup() {
    return '' +
      '<div class="nt-clock">' +
        '<span class="nt-time" data-ref="time">--:--</span>' +
        '<span class="nt-weekday" data-ref="weekday">星期</span>' +
      '</div>' +
      '<span class="nt-sep"></span>' +
      '<span class="nt-window" data-ref="window" hidden>' +
        '<i class="nt-dot"></i>' +
        '<span class="nt-win-label" data-ref="winLabel">谷时</span>' +
        '<b class="nt-win-eta" data-ref="winEta"></b>' +
      '</span>' +
      '<div class="nt-cost" data-ref="cost" hidden>' +
        '<span class="nt-cost-item"><i>今日</i><b data-ref="today">—</b></span>' +
        '<span class="nt-cost-item"><i>会话</i><b data-ref="session">—</b></span>' +
        '<span class="nt-cost-item nt-cost-balance" data-ref="balanceItem" hidden><i>余额</i><b data-ref="balance">—</b></span>' +
      '</div>' +
      '<span class="nt-sep nt-sep-cost" data-ref="costSep" hidden></span>' +
      '<div class="nt-oc" data-ref="oc" hidden>' +
        '<span class="nt-oc-item" data-ref="ocRollingItem"><i>5时</i><b data-ref="ocRolling">—</b></span>' +
        '<span class="nt-oc-item" data-ref="ocWeeklyItem"><i>本周</i><b data-ref="ocWeekly">—</b></span>' +
        '<span class="nt-oc-item" data-ref="ocMonthlyItem"><i>本月</i><b data-ref="ocMonthly">—</b></span>' +
      '</div>' +
      '<span class="nt-sep nt-sep-oc" data-ref="ocSep" hidden></span>' +
      '<div class="nt-actions">' +
        '<button class="nt-btn nt-theme" data-ref="theme" type="button" title="切换明暗"></button>' +
        '<button class="nt-btn nt-more" data-ref="more" type="button" title="展开功能面板" aria-expanded="false">' + CHEVRON_SVG + '</button>' +
      '</div>' +
      '<div class="nt-panel" data-ref="panel" aria-hidden="true">' +
        '<div class="nt-panel-head">' +
          '<div>' +
            '<div class="nt-bigtime" data-ref="bigtime">--:--</div>' +
            '<div class="nt-bigdate" data-ref="bigdate">—</div>' +
            '<span class="nt-lunar" data-ref="lunar"></span>' +
          '</div>' +
          '<div class="nt-avatar">' +
            '<div class="nt-daynum" data-ref="daynum">--</div>' +
            '<span class="nt-month" data-ref="month">—</span>' +
          '</div>' +
        '</div>' +
        '<div class="nt-stats">' +
          '<div class="nt-stat" data-ref="statToday"><span>今日</span><b>—</b><em hidden></em></div>' +
          '<div class="nt-stat" data-ref="statSession"><span>本次会话</span><b>—</b><em hidden></em></div>' +
          '<div class="nt-stat" data-ref="statBalance"><span>余额</span><b>—</b><em hidden></em></div>' +
        '</div>' +
        '<div class="nt-oc-meta" data-ref="ocMeta" hidden></div>' +
        '<div class="nt-divider"></div>' +
        '<div class="nt-row">' +
          '<span>主题模式</span>' +
          '<div class="nt-seg" role="group" aria-label="主题模式">' +
            '<button type="button" data-mode="light" aria-pressed="false">浅色</button>' +
            '<button type="button" data-mode="dark" aria-pressed="false">深色</button>' +
            '<button type="button" data-mode="auto" aria-pressed="false">跟随</button>' +
          '</div>' +
        '</div>' +
        '<div class="nt-panel-foot">' +
          '<button class="nt-link" data-ref="costSettings" type="button" hidden>费用设置</button>' +
          '<span>拟态主题 v0.2</span>' +
        '</div>' +
      '</div>'
  }

  function mount() {
    if (el && document.body) {
      if (!el.isConnected) document.body.appendChild(el)
      return
    }
    if (!document.body) return

    el = document.createElement('div')
    el.id = 'nt-notch'
    el.setAttribute('role', 'toolbar')
    el.setAttribute('aria-label', '顶部功能刘海：时间、费用与明暗模式')
    el.innerHTML = markup()
    document.body.appendChild(el)

    refs = {}
    var nodes = el.querySelectorAll('[data-ref]')
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i]
      refs[node.getAttribute('data-ref')] = node
    }
    state.mounted = true

    el.addEventListener('click', function (event) {
      if (event.target.closest('button')) return
      if (event.target.closest('.nt-panel')) return
      setOpen(!state.panelOpen)
    })

    if (byRef('theme')) {
      byRef('theme').addEventListener('click', function (event) {
        event.stopPropagation()
        applyMode(isDarkMode() ? 'light' : 'dark', true)
        syncIcons()
      })
    }

    if (byRef('more')) {
      byRef('more').addEventListener('click', function (event) {
        event.stopPropagation()
        setOpen(!state.panelOpen)
      })
    }

    var segments = el.querySelectorAll('[data-mode]')
    for (var j = 0; j < segments.length; j += 1) {
      segments[j].addEventListener('click', function (event) {
        event.stopPropagation()
        applyMode(this.getAttribute('data-mode'), true)
      })
    }

    if (byRef('costSettings')) {
      byRef('costSettings').addEventListener('click', function (event) {
        event.stopPropagation()
        var gear = document.querySelector('.dshcn-n-gear')
        if (gear && typeof gear.click === 'function') gear.click()
        setOpen(false)
      })
    }

    syncIcons()
    syncSegments()
    syncCostNotch()
  }

  function bindGlobalHandlers() {
    document.addEventListener('pointerdown', function (event) {
      if (!state.panelOpen || !el) return
      if (el.contains(event.target)) return
      setOpen(false)
    }, true)

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && state.panelOpen) setOpen(false)
    })

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        refreshCost()
        syncCostNotch()
      }
    })

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', function () {
        if (state.mode === 'auto') setDark(media.matches)
      })
    }

    /*
     * 本体切换主题时会改 body 上的 data-ds-dark-theme。只要用户在本面板里选过
     * 模式，这里就把属性拉回用户选的那一档；没选过则完全不动，交给本体设置。
     */
    var observer = new MutationObserver(function () {
      syncIcons()
      syncSegments()
      if (!state.mode) return
      if (state.mode === 'auto') {
        if (isDarkMode() !== media.matches) setDark(media.matches)
        return
      }
      var wantDark = state.mode === 'dark'
      if (isDarkMode() !== wantDark) setDark(wantDark)
    })
    if (document.body) {
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'] })
    }
  }

  function boot() {
    mount()
    state.mode = readStoredMode()
    if (state.mode) applyMode(state.mode, false)
    tick()
    refreshCost()
    syncCostNotch()
    syncSegments()

    if (!tickTimer) tickTimer = window.setInterval(tick, 1000)
    if (!pollTimer) pollTimer = window.setInterval(function () { refreshCost() }, 60000)
    if (!syncTimer) syncTimer = window.setInterval(syncCostNotch, 5000)

    bindGlobalHandlers()
  }

  if (document.body) boot()
  else document.addEventListener('DOMContentLoaded', boot)
}
