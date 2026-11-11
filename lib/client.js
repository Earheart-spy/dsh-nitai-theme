/**
 * dsh-nitai-theme 的浏览器半区。
 *
 * 这里负责三件事：
 *   1. 在页面顶部挂一颗拟态胶囊（刘海），显示时间、星期、今日费用、本次会话费用；
 *   2. 点开面板后显示大时钟、农历、余额和三档明暗模式开关；
 *   3. 如果同一台机器还装着 dsh-cost-notch，就隐藏它原来的顶部条，并把它的
 *      齿轮入口接到面板里，避免两条横条叠在一起，也保留费用设置的去处。
 *
 * 脚本由宿主以 <script src> 注入，只执行一次；重复注入时直接返回。
 */

;(function () {
  'use strict'

  if (window.__dshNitaiThemeLoaded) return
  window.__dshNitaiThemeLoaded = true

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
  function setStat(name, value) {
    var stat = byRef(name)
    if (!stat) return
    var node = stat.querySelector('b') || stat
    node.textContent = formatMoney(value)
    stat.classList.toggle('nt-stat-empty', !isNumber(value))
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
    var info = state.cost && state.cost.peakWindow
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

  function renderCost() {
    var cost = state.cost || {}
    var hasCost = isNumber(cost.today) || isNumber(cost.session) || isNumber(cost.balance)

    if (byRef('cost')) byRef('cost').hidden = !hasCost
    if (byRef('costSep')) byRef('costSep').hidden = !hasCost

    if (hasCost) {
      if (byRef('today')) byRef('today').textContent = formatMoney(cost.today)
      if (byRef('session')) byRef('session').textContent = formatMoney(cost.session)
      if (byRef('balance')) byRef('balance').textContent = formatMoney(cost.balance)
    }
    if (byRef('balanceItem')) byRef('balanceItem').hidden = !isNumber(cost.balance)

    setStat('statToday', cost.today)
    setStat('statSession', cost.session)
    setStat('statBalance', cost.balance)
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
    var timer = controller ? window.setTimeout(function () { controller.abort() }, 4000) : null
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
    if (document.body) document.body.classList.toggle('nt-has-costbar', !!costNotch)
    if (byRef('costSettings')) byRef('costSettings').hidden = !gear
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
          '<div class="nt-stat" data-ref="statToday"><span>今日</span><b>—</b></div>' +
          '<div class="nt-stat" data-ref="statSession"><span>本次会话</span><b>—</b></div>' +
          '<div class="nt-stat" data-ref="statBalance"><span>余额</span><b>—</b></div>' +
        '</div>' +
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
          '<span>拟态主题 v0.1</span>' +
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
})()
