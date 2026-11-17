/*
 * 配置自检脚本（只在调试时用）：在真实页面里把每项配置轮流设成不同档位，
 * 再读回目标元素的计算样式，确认「配置真的画到了元素上」。
 *
 * 用法（Chrome 控制台 / DevTools MCP）：
 *   const r = await window.__ntAudit(['raised-md', 'inset-md', 'flat'])
 *   console.table(r)   // 每项一张表：哪个档位没生效
 *
 * 它只通过本插件的三条路由工作：/surfaces.json?debug=1 提供选择器，
 * /config.json 写入配置，/theme.css 取回带覆盖规则的新样式。
 */
(function () {
  /* 每个档位对应的「计算后应该出现的特征」，用来判断规则是否真的落到元素上。 */
  var EXPECT = {
    'raised-sm': { text: '5px 5px 12px', inset: false },
    'raised-md': { text: '9px 9px 21px', inset: false },
    'raised-lg': { text: '18px 18px 42px', inset: false },
    'inset-sm': { text: '2px 2px 4px', inset: true },
    'inset-md': { text: '3px 3px 7px', inset: true },
    'outline': { text: '0px 0px 0px 1px', inset: true },
    'flat': { text: 'none', inset: false }
  }

  /* 伪元素没法读计算样式，改为核对注入样式表里写进去的值；必须和 surfaces.js 的 SHADOW_CSS 一致。 */
  var PSEUDO_CSS = {
    '': '',
    'raised-sm': 'var(--nt-raised-sm)',
    'raised-md': 'var(--nt-raised)',
    'raised-lg': 'var(--nt-raised-lg)',
    'inset-sm': 'var(--nt-inset-soft)',
    'inset-md': 'var(--nt-inset)',
    'flat': 'none',
    'outline': 'inset 0 0 0 1px var(--nt-hairline-soft)'
  }

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function judge(shadow, style, custom) {
    var want = EXPECT[style]
    if (!want) return true
    var text = normalize(shadow)
    if (style === 'flat') return text === 'none'
    /*
     * 少数元素有专属阴影（会话头部贴在窗口顶边，普通凸起看不出效果）。
     * 这类元素的期望值不能按公共档位去比，改成两步核对：
     * 一是这一档确实被写进了样式表，二是元素上确实有阴影（不是 none）。
     */
    if (custom) {
      return text !== 'none' && SHEET_TEXT.indexOf(custom) !== -1
    }
    var hasInset = text.indexOf('inset') !== -1
    return hasInset === want.inset && text.indexOf(want.text) !== -1
  }

  /* 当前注入的样式表文本，供专属阴影的核对使用。 */
  var SHEET_TEXT = ''

  function post(cfg) {
    return fetch('/dsh-nitai-theme/config.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(cfg)
    }).then(function (r) { return r.json() })
  }

  function loadCss() {
    return fetch('/dsh-nitai-theme/theme.css', { credentials: 'same-origin' })
      .then(function (r) { return r.text() })
  }

  function apply(css) {
    var tag = document.getElementById('nitai-theme-css')
    if (tag) tag.textContent = css
    SHEET_TEXT = css || ''
    /* 主题里给不少元素挂了 0.18s 的过渡，等它走完再读计算样式，否则读到中间值。 */
    return new Promise(function (resolve) { setTimeout(resolve, 260) })
  }

  function configFor(ids, style) {
    var surfaces = {}
    ids.forEach(function (id) {
      surfaces[id] = { enabled: true, states: { default: style } }
    })
    return { version: 1, surfaces: surfaces }
  }

  window.__ntAudit = async function (styles) {
    styles = styles && styles.length ? styles : ['raised-md', 'inset-md', 'flat']
    var meta = await fetch('/dsh-nitai-theme/surfaces.json?debug=1', { credentials: 'same-origin' }).then(function (r) { return r.json() })
    var list = meta.surfaces
    var ids = list.map(function (s) { return s.id })
    var report = {}

    for (var i = 0; i < styles.length; i++) {
      var style = styles[i]
      await post(configFor(ids, style))
      await apply(await loadCss())
      for (var j = 0; j < list.length; j++) {
        var item = list[j]
        var row = report[item.id] || (report[item.id] = { id: item.id, name: item.name, detail: {} })
        var el = null
        /* 伪元素（例如滚动条滑块 ::-webkit-scrollbar-thumb）不能用 querySelector 选到，
           这时把选择器交给 getComputedStyle 的第二个参数，它是个纯字符串，不会抛异常。 */
        if (item.selector.indexOf('::') === 0) {
          /*
           * 滚动条这类伪元素，Chromium 的 getComputedStyle 读不出它的样式（只支持
           * ::before / ::after / ::marker 等少数几个），所以改成检查注入的样式表文本里
           * 有没有写进对应的那条规则。规则在就说明配置真的生效了。
           */
          var sheet = document.getElementById('nitai-theme-css')
          var text = sheet ? sheet.textContent : ''
          var want = PSEUDO_CSS[style] || ''
          var hit = text.indexOf(item.selector + ' { box-shadow: ' + want) !== -1
          row.detail[style] = hit ? 'ok' : 'fail:no-rule'
          continue
        }
        try { el = document.querySelector(item.selector) } catch (e) { row.detail[style] = 'bad-selector'; continue }
        if (!el) { row.detail[style] = 'no-element'; continue }
        var shadow = getComputedStyle(el).boxShadow
        var custom = item.shadow && item.shadow[style] ? item.shadow[style] : ''
        row.detail[style] = judge(shadow, style, custom) ? 'ok' : 'fail:' + normalize(shadow).slice(0, 52)
      }
    }

    await post({ version: 1, surfaces: {} })
    await apply(await loadCss())
    return Object.keys(report).map(function (id) { return report[id] })
  }
})()
