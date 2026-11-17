/*
 * 个性化配置（新拟态阴影）配置清单。
 *
 * 每一项对应界面上一类可以看清的地方（一个按钮、一张卡片、一条消息……）。
 * 主题自带的效果写在 lib/theme.css 里，这里不改动它：用户勾选并选好某一档样式后，
 * 宿主会生成一条「body + 选择器」的覆盖规则，追加在 theme.css 之后一起下发。
 * 没被配置的状态自然回落到主题原来的写法，所以这份配置坏掉最多是「没生效」，
 * 不会把界面弄乱。
 *
 * 选择器约定：
 *   - 优先用语义锚点（data-* 属性、role、元素类型），DSH 升级后不容易失效；
 *   - 其次用 DSH 的模块类名，写成 [class~="模块_类名"] 的精确匹配，
 *     这样才能避开名字相近的子元素（早前用 [class*="…"] 误伤过「新会话」按钮的子节点）；
 *   - 带构建哈希的类名只作为兜底写在后半段，哈希变了也只是这条失效。
 */

export const SHADOW_STYLES = {
  '': '跟随主题默认',
  'raised-sm': '凸起 · 小',
  'raised-md': '凸起 · 中',
  'raised-lg': '凸起 · 大',
  'inset-sm': '内凹 · 浅',
  'inset-md': '内凹 · 深',
  'flat': '平面（去掉阴影）',
  'outline': '细描边'
};

/* 每一档样式对应的 box-shadow 值；空字符串表示「不覆盖」，让主题自己的写法生效。 */
export const SHADOW_CSS = {
  '': '',
  'raised-sm': 'var(--nt-raised-sm)',
  'raised-md': 'var(--nt-raised)',
  'raised-lg': 'var(--nt-raised-lg)',
  'inset-sm': 'var(--nt-inset-soft)',
  'inset-md': 'var(--nt-inset)',
  'flat': 'none',
  'outline': 'inset 0 0 0 1px var(--nt-hairline-soft)'
};

/*
 * 清单本体。
 *   id      写入配置文件时用的键，改了就相当于换了一个元素，尽量别动；
 *   group   设置面板里的分组标题；
 *   states  这个元素值得单独调的交互状态，默认 default 一定有；
 *   notes   给设置面板显示的一句说明。
 */
export const SURFACES = [
  {
    id: 'scrollbar-thumb',
    name: '滚动条滑块',
    group: '全局',
    states: ['default', 'hover'],
    selector: '::-webkit-scrollbar-thumb',
    note: '细长的一条，凸起会让它显得更粗。'
  },
  {
    id: 'new-session',
    name: '侧栏 · 新会话按钮',
    group: '侧栏',
    states: ['default', 'hover'],
    selector: '[class~="wtg9ga_newSession"]',
    note: '侧栏最上面那颗大按钮。'
  },
  {
    id: 'nav-row',
    name: '侧栏 · 导航行（插件 / 自动化任务 / 更多）',
    group: '侧栏',
    states: ['default', 'hover', 'active'],
    selector: '[class~="wtg9ga_panelRow"]',
    activeSelector: '[class~="wtg9ga_panelRow"][aria-current="page"]',
    note: '「选中」指当前打开的那一项，DSH 用 aria-current="page" 标记它，不是鼠标按下的瞬间。'
  },
  {
    id: 'section-icon',
    name: '侧栏 · 标题小图标（搜索 / 视图选项 / 添加工作区）',
    group: '侧栏',
    states: ['default', 'hover', 'active'],
    selector: '[class~="GAkraW_iconButton"], [class~="GAkraW_searchButton"]',
    note: '「工作区」标题右边那三颗 28px 的小按钮。它们彼此只隔 4px，给「常态」选凸起时两颗的阴影会撞在一起，建议保持平面或只改悬停。'
  },
  {
    id: 'session-row',
    name: '侧栏 · 会话行',
    group: '侧栏',
    states: ['default', 'hover', 'active'],
    selector: '[class~="wnFoaW_sessionRow"]',
    activeSelector: '[class~="wnFoaW_sessionRow"][aria-selected="true"]',
    note: '已经按滚动视口的留白收窄过，别把边距改回 0；「选中」是当前打开的那个会话。'
  },
  {
    id: 'project-row',
    name: '侧栏 · 工作区行',
    group: '侧栏',
    states: ['default', 'hover', 'active'],
    selector: '[class~="wnFoaW_projectRow"]',
    activeSelector: '[class~="wnFoaW_projectRow"][aria-expanded="true"]',
    note: '标题那一行。DSH 没给工作区行单独的选中样式，所以这里的「选中」对应展开着的工作区。'
  },
  {
    id: 'sidebar-search',
    name: '侧栏 · 搜索框',
    group: '侧栏',
    states: ['default', 'hover'],
    selector: '[class~="GAkraW_search"]',
    note: '凹槽画在外面这颗胶囊上，里面的输入框是平的；DSH 的输入框是 type="text"，别写成 input[type="search"]。'
  },
  {
    id: 'account-card',
    name: '侧栏 · 底部账户卡',
    group: '侧栏',
    states: ['default', 'hover'],
    selector: '[aria-haspopup="menu"][data-collapsed]',
    note: '用 aria 锚点定位，比类名稳。'
  },
  {
    id: 'hover-card',
    name: '侧栏 · 会话悬停预览卡',
    group: '侧栏',
    states: ['default'],
    selector: '[class~="wnFoaW_hoverContent"]',
    note: '鼠标停在会话行上弹出的那张卡。'
  },
  {
    id: 'header',
    name: '会话头部 · 整条容器',
    group: '会话头部',
    states: ['default'],
    selector: '[class~="an3WzG_header"]',
    /*
     * 头部是通栏、又贴着窗口顶边，普通的「凸起」在这里几乎看不见：
     * 上、左、右三个方向的外阴影都被窗口和栏目边界裁掉了，只剩下面那一条，
     * 而 18px 偏移 + 42px 模糊的阴影铺开六十多像素，落在浅灰画布上只是一层薄雾。
     * 所以凸起档改成「窗台式」写法：顶部一道白色高光、底部一道暗色细线、下面压一层收紧的投影。
     * 这样凸起在头部下沿形成一条清楚的分界，一眼就能看出这块板浮在画布上面。
     */
    shadow: {
      'raised-sm': 'inset 0 1px 0 var(--nt-shadow-light), inset 0 -1px 0 var(--nt-hairline-soft), 0 6px 12px -6px var(--nt-shadow-dark)',
      'raised-md': 'inset 0 1px 0 var(--nt-shadow-light), inset 0 -1px 0 var(--nt-hairline-soft), 0 8px 16px -7px var(--nt-shadow-dark)',
      'raised-lg': 'inset 0 1px 0 var(--nt-shadow-light), inset 0 -1px 0 var(--nt-hairline-soft), 0 10px 20px -8px var(--nt-shadow-dark)'
    },
    /* 让头部自己抬起一层，否则它下面那条投影会被后画的消息区盖住。 */
    elevate: true,
    note: '头部贴着窗口顶边，只有下沿能露出阴影，所以这里的凸起是「底边压一道线 + 下方投影」。'
  },
  {
    id: 'tab-bar',
    name: '会话头部 · 标签条容器',
    group: '会话头部',
    states: ['default'],
    selector: '[class~="an3WzG_viewTabs"]',
    note: '标签外面的那条凹槽。它现在会跟着标签一起伸缩，凹槽高度总是比标签多 4px，不会再出现「字比槽大」。'
  },
  {
    id: 'tab',
    name: '会话头部 · 单个标签',
    group: '会话头部',
    states: ['default', 'hover', 'active'],
    selector: '[class~="an3WzG_tab"]',
    activeSelector: '[class~="an3WzG_tabActive"]',
    note: '三种状态共用同一个盒子（内边距固定 5px 12px），换状态只换底色和阴影，标签位置不会跳。悬停建议只换底色，因为相邻标签只隔 6px，选凸起时两团阴影会叠在一起。'
  },
  {
    id: 'header-action',
    name: '会话头部 · 右上工具按钮',
    group: '会话头部',
    states: ['default', 'hover'],
    selector: '[class~="an3WzG_headerActions"] button, [class~="an3WzG_headerUtilities"] button',
    note: '这一排挨着容器边缘，主题默认是平面，悬停才轻微内凹。'
  },
  {
    id: 'user-bubble',
    name: '正文 · 用户消息气泡',
    group: '对话正文',
    states: ['default'],
    selector: '[class*="_bubble_"], [class*="LOmM4q_bubble"]',
    note: '气泡默认是凸起，影子朝右下。新版 DSH 的类名形如 _bubble_1sgyj_1，所以按片段匹配。'
  },
  {
    id: 'msg-actions',
    name: '正文 · 消息悬停操作条',
    group: '对话正文',
    states: ['default', 'hover'],
    selector: '[class~="cVfUIq_actions"], [class~="LOmM4q_actions"]',
    /* 操作条原生是直角的一条，加阴影会露出方角。 */
    radius: '10px',
    note: '鼠标停在消息上出现的那排图标；配置后统一为 10px 圆角。'
  },
  {
    id: 'code-block',
    name: '正文 · 代码块',
    group: '对话正文',
    states: ['default'],
    selector: 'pre',
    note: '代码块默认内凹，像刻进纸里的槽。'
  },
  {
    id: 'inline-code',
    name: '正文 · 行内代码',
    group: '对话正文',
    states: ['default'],
    selector: ':not(pre) > code',
    /* 行内代码的字号小，圆角太大反而像药丸，所以给它一个小一点的圆角。 */
    radius: '6px',
    note: '句子中间那一小截等宽字；配置后统一为 6px 圆角。'
  },
  {
    id: 'table',
    name: '正文 · 表格',
    group: '对话正文',
    states: ['default'],
    selector: '.md-table-wide > table, [class*="_markdown"] table',
    note: '宽表已经被 layout-fix.css 拉齐宽度，这里只管阴影。'
  },
  {
    id: 'diff-view',
    name: '正文 · 文件改动（差异）视图',
    group: '对话正文',
    states: ['default'],
    selector: '[class*="_diffFence_"], [class*="_0cITKW_root"]',
    /* 差异块原生没有圆角，行与行之间是一条条直边，配置后统一收成 10px。 */
    radius: '10px',
    note: '正文里的代码片段差异块用 _diffFence_，文件编辑弹窗里的差异视图用 _0cITKW_，两种都覆盖；配置后统一为 10px 圆角。'
  },
  {
    id: 'tool-card',
    name: '正文 · 工具调用 / 思考块',
    group: '对话正文',
    states: ['default', 'hover'],
    selector: '[class*="pDft-q_callRow"], [class*="VJlF5q_root"], [class*="iFrn8G_root"]',
    /*
     * 这三类里只有工具调用行自带 8px 圆角，思考块和上下文注入块是直角。
     * 配置只加阴影时，直角的那两块会露出方角，看起来一半圆一半方，
     * 所以这里指定一个统一圆角，让三块在配置后形状一致。
     */
    radius: '12px',
    note: '工具调用行、思考块、上下文注入块这三类，都在正文里以卡片形式出现；配置后三项统一为 12px 圆角。'
  },
  {
    id: 'composer',
    name: '输入区 · 输入卡',
    group: '输入区',
    states: ['default', 'hover'],
    selector: '[data-composer-card]',
    note: '用语义属性定位，不依赖类名。'
  },
  {
    id: 'composer-button',
    name: '输入区 · 卡内工具按钮',
    group: '输入区',
    states: ['default', 'hover'],
    selector: '[data-composer-card] button:not([class*="_primary"])',
    note: '加号、访问模式、模型选择这些；发送按钮单独一项，所以这里把它排除掉，免得两项互相覆盖。'
  },
  {
    id: 'send-button',
    name: '输入区 · 发送按钮',
    group: '输入区',
    states: ['default', 'hover'],
    selector: '[data-composer-card] button[class*="_primary"], [data-composer-card] button[type="submit"]',
    note: '发送按钮是卡里那颗主操作按钮，类名带 _primary 后缀（新版 DSH 的 type 是 button，不是 submit）。'
  },
  {
    id: 'attachment',
    name: '输入区 · 附件预览卡',
    group: '输入区',
    states: ['default'],
    selector: '[class~="EEnIVa_card"]',
    note: '拖进来还没发出去的文件小卡片，类名是 EEnIVa_card，外面那层 Onur9G_item 只是排布容器。'
  },
  {
    id: 'rightbar-tabs',
    name: '右栏 · 标签栏',
    group: '右栏',
    states: ['default', 'hover'],
    selector: '[class*="_tabHost_"] [role="tab"]',
    /* 标签本身是直角，配置阴影后会露出方角，统一成 8px。 */
    radius: '8px',
    note: '右栏顶部那一排标签，容器类名带 _tabHost_ 前缀，标签本身是 role=tab；配置后统一为 8px 圆角。'
  },
  {
    id: 'tool-entry',
    name: '右栏 · 工具卡',
    group: '右栏',
    states: ['default', 'hover'],
    selector: '[class~="p2k40q_entry"], [class~="-4GESq_entry"]',
    /* 工具入口原生没有圆角，配置后统一成 12px。 */
    radius: '12px',
    note: '右栏里一格一格的工具入口；用完整类名精确匹配，避免把 entryIcon / entryTitle 这些子元素一起选中；配置后统一为 12px 圆角。'
  },
  {
    id: 'menu',
    name: '浮层 · 下拉菜单面板',
    group: '浮层',
    states: ['default'],
    selector: '[role="menu"]',
    note: '菜单面板本身。'
  },
  {
    id: 'menu-item',
    name: '浮层 · 菜单项',
    group: '浮层',
    states: ['default', 'hover', 'active'],
    selector: '[role="menuitem"]',
    activeSelector: '[role="menuitem"]:focus-visible',
    note: '菜单里的一行。菜单没有“选中”的常驻状态，这里的「选中」指键盘方向键移到这一行时的高亮。'
  },
  {
    id: 'dialog',
    name: '浮层 · 弹窗',
    group: '浮层',
    states: ['default'],
    selector: '[role="dialog"]',
    note: '设置、确认这类弹窗。'
  },
  {
    id: 'dialog-primary',
    name: '主按钮（确定 / 添加插件等）',
    group: '浮层',
    states: ['default', 'hover'],
    selector: 'button[class*="_primary_1ulci"], [role="dialog"] button[class*="_primary_"]',
    note: '界面上的主要动作按钮（例如插件页的「添加插件」）。DSH 的按钮变体是 _primary_1ulci_NN 这种带构建哈希的类名，所以用包含匹配；这一版弹窗里只有描边次要按钮，没有主按钮，别按「弹窗主按钮」去配置。'
  },
  {
    id: 'tooltip',
    name: '浮层 · 工具提示 / 轻提示',
    group: '浮层',
    states: ['default'],
    selector: '[role="tooltip"]',
    note: '鼠标停留后冒出的小方块。'
  },
  {
    id: 'notch',
    name: '刘海 · 胶囊本体',
    group: '刘海',
    states: ['default', 'hover'],
    selector: '#nt-notch',
    note: '窗口顶部那条。'
  },
  {
    id: 'notch-button',
    name: '刘海 · 图标按钮',
    group: '刘海',
    states: ['default', 'hover'],
    selector: '#nt-notch .nt-btn',
    note: '明暗切换、展开箭头。'
  },
  {
    id: 'notch-panel',
    name: '刘海 · 展开面板',
    group: '刘海',
    states: ['default'],
    selector: '#nt-notch .nt-panel',
    note: '点箭头后弹下来的那一块。'
  },
  {
    id: 'notch-stat',
    name: '刘海 · 面板里的统计槽',
    group: '刘海',
    states: ['default'],
    selector: '#nt-notch .nt-stat',
    note: '今日 / 会话 / 余额 三个小格。'
  },
  {
    id: 'notch-seg',
    name: '刘海 · 明暗分段控件',
    group: '刘海',
    states: ['default'],
    selector: '#nt-notch .nt-seg',
    note: '浅色 / 跟随 / 深色 那组按钮。'
  }
];

export const SURFACE_BY_ID = new Map(SURFACES.map(item => [item.id, item]));

/*
 * 把用户配置翻译成一段覆盖 CSS。
 *
 * 配置形状：{ version: 1, surfaces: { <id>: { enabled: true, states: { default: 'raised-sm', hover: '', active: '' } } } }
 * 只处理 enabled 为真、且该状态选了非空样式的项；其余一律跳过，交给 theme.css 的原始写法。
 * 选择器前面加 body，是为了让这条规则比主题里同名的规则更具体，从而稳定压过它。
 */
export function buildOverrideCss (config) {
  const surfaces = (config && config.surfaces) || {};
  const blocks = [];

  for (const item of SURFACES) {
    const entry = surfaces[item.id];
    if (!entry || !entry.enabled) continue;

    const states = entry.states || {};
    for (const state of item.states) {
      const value = states[state];
      /*
       * 少数元素有自己的专属阴影（例如贴在窗口顶边、普通凸起根本看不出来的会话头部）。
       * 这类元素在清单里写一个 shadow 表，只覆盖其中几档，其余档位仍走公共的 SHADOW_CSS。
       */
      const css = (item.shadow && item.shadow[value]) || SHADOW_CSS[value];
      if (!css) continue;

      /*
       * 大多数元素的「选中」就是 CSS 的 :active 伪类；标签这类元素改用另一个类名
       * 表示选中（an3WzG_tabActive），那时不能再补 :active，否则永远匹配不上。
       */
      const usesClass = state === 'active' && !!item.activeSelector;
      const base = usesClass ? item.activeSelector : item.selector;
      const suffix = state === 'default' || usesClass ? '' : ':' + state;
      /*
       * 一个元素可能对应多个选择器（例如「侧栏 · 标题小图标」同时覆盖放大镜与另外两颗）。
       * 这里逐个补上前缀：只给逗号列表的第一个选择器加前缀，后面的选择器特异性会低一档，
       * 可能压不过主题自带规则，配置就表现得时灵时不灵。
       *
       * 前缀里的 :not(#nt-config-noop) 是一个永远不存在的 id，作用只有一个：
       * 让整条规则带上“一个 id”的特异性权重。主题里有几条为了精确排除而堆了很多
       * :not([class*=...]) 的通配规则（比如卡片那条有六个类选择器），只靠 body 前缀
       * 压不住它们；id 权重高于任意多个类选择器，所以这样写能稳定赢，且不影响匹配。
       */
      const selectors = base
        .split(',')
        .map(part => {
          const trimmed = part.trim()
          /*
           * 伪元素（滚动条滑块 ::-webkit-scrollbar-thumb）不能跟在 body 后面加空格：
           * 那样写出来的是「body 里的后代元素」，而不是元素自己的滚动条。
           * 正确写法是挂到任意元素上，即 *:not(#nt-config-noop)::-webkit-scrollbar-thumb。
           */
          if (trimmed.indexOf('::') === 0) return '*:not(#nt-config-noop)' + trimmed + suffix
          return 'body:not(#nt-config-noop) ' + trimmed + suffix
        })
        .join(', ');
      blocks.push(selectors + ' { box-shadow: ' + css + ' !important; }');
      /*
       * 有些元素本身没有圆角（DSH 只给其中一部分写了 border-radius），
       * 一旦给它们加阴影，就会出现「一半圆角、一半直角」的方块。
       * 这类元素在清单里写一个 radius，配置生效时连带把圆角统一掉。
       */
      if (item.radius) {
        blocks.push(selectors + ' { border-radius: ' + item.radius + ' !important; }');
      }
      /*
       * 通栏元素（目前只有会话头部）要额外抬一层，否则它下方那条投影会被后画的内容区盖掉，
       * 于是选「凸起」时用户什么也看不到。z-index 只有 3，不影响弹窗、菜单这些高层级浮层。
       */
      if (item.elevate) {
        blocks.push(selectors + ' { position: relative !important; z-index: 3 !important; }');
      }
    }
  }

  if (!blocks.length) return '';
  return '\n/* 以下规则由「个性化配置」配置生成，改配置后自动重新生成 */\n' + blocks.join('\n') + '\n';
}
