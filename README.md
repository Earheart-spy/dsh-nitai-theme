# 拟态主题 · 功能刘海（dsh-nitai-theme）

给本机 DeepSeek Harness 桌面端做的一套拟态风格主题，外加一个顶部功能刘海。主题和刘海都装在一个本地插件里，跟随 DSH 自带的明暗切换，不修改任何 DSH 源文件。

## 现在长什么样

亮色与暗色，都是冷灰底 + 浮起的浅色卡片 + 左上受光、右下投影的软阴影；强调色是低饱和的青蓝。

| 亮色 | 暗色 |
| --- | --- |
| ![亮色](docs/desktop-light.png) | ![暗色](docs/desktop-dark.png) |

刘海展开后的面板：

| 亮色面板 | 暗色面板 |
| --- | --- |
| ![亮色面板](docs/desktop-light-panel.png) | ![暗色面板](docs/desktop-dark-panel.png) |

侧栏会话或工作区在鼠标悬停时弹出的卡片也改成了拟态卡片，不再是固定的深色浮层：

| 亮色悬浮卡 | 暗色悬浮卡 |
| --- | --- |
| ![亮色悬浮卡](docs/hover-card-light.png) | ![暗色悬浮卡](docs/hover-card-dark.png) |

独立预览页（模拟了聊天、气泡、代码块、表格和输入卡，方便不启动 DSH 也能看主题）：

| 预览亮色 | 预览暗色 |
| --- | --- |
| ![预览亮色](docs/preview-light-panel.png) | ![预览暗色](docs/preview-dark-panel.png) |

## 安装状态

已经装进本机的桌面端配置：

- 插件目录：`C:\Users\18385\Documents\dsh\nitai-theme`
- 桌面端 profile：`C:\Users\18385\.dsh\profiles\desktop`
- 已建立目录链接：`node_modules\dsh-nitai-theme` → 上面的插件目录
- `package.json` 里已加入依赖 `dsh-nitai-theme`，并加入 `dsh.profile.bundles`
- 原文件备份在 `C:\Users\18385\.dsh\profiles\desktop\package.json.bak-nitai`

**重启 DeepSeek Harness 桌面端后生效。** 当前正在运行的窗口不会热加载这个插件。

## 刘海怎么用

刘海固定在窗口顶部中间，不遮挡两侧的窗口拖动区，也不影响右上角的窗口按钮。

收起时从左到右依次是：

1. 当前时间（每秒更新）
2. 星期几
3. 峰谷状态圆点、状态文字和倒计时（由主题自己按北京时间计算）
4. 今日费用
5. 本次会话费用
6. 余额（和费用同一行显示，没登录时这一项隐藏）
7. 月亮 / 太阳按钮：一键切换亮暗
8. 向下箭头：展开面板

展开面板里有：

- 大号时钟、完整日期、农历
- 今天的日号、月份
- 今日费用、本次会话费用、余额三格
- 主题模式三段开关：浅色 / 深色 / 跟随系统
- “费用设置”入口：直接打开 `dsh-cost-notch` 的设置

点面板外面或按 `Esc` 关闭面板。主题选择会写进浏览器的 `localStorage`，键名是 `dsh-nitai-theme.mode`，值是 `light`、`dark` 或 `auto`。桌面端每次启动可能换本地端口，而 `localStorage` 按端口隔离，所以同时写了一份 Cookie（`nt_mode`，按主机共享），换端口后仍然记得住。没有选过时跟随系统。

## 和 dsh-cost-notch 的关系

费用不再依赖 `dsh-cost-notch` 才能显示。主题宿主自己监听会话事件，每收到一条带用量的助手消息，就按同一套价格表把这一轮的费用累加进自己的账本：

- 账本文件：`C:\Users\18385\.dsh\nitai-theme\usage.json`
- 第一次启动时，会从 `dsh-cost-notch` 的旧账本 `C:\Users\18385\.dsh\cost-notch\ledger.json` 补一次历史数据；如果旧账本比实际落后，会再读当前会话的事件日志（`~/.dsh/sessions/.../session.v4.jsonl.zstd`）补差额，不会重复累加
- 之后两边同时记账时取较大值，不会相加翻倍
- 峰谷状态按北京时间计算，不读网络
- 余额仍向 DSH 的账户服务查询；没有登录或查询失败时余额项隐藏，不影响时间和费用

本机已经装了 `dsh-cost-notch`，它原本也有一条顶部费用条。两个都显示会叠在一起，所以这个主题在检测到 `.dshcn-notch` 时：

- 给 `body` 加 `nt-has-costbar`
- 用 CSS 把原来的顶部费用条隐藏
- 显示“费用设置”入口，点了直接打开 `dsh-cost-notch` 的设置
- 输入框下方的会话费用胶囊保持原样，不动

如果想让原来的费用条回来，删掉 `lib/theme.css` 里这条规则即可：

```css
body.nt-has-costbar .dshcn-notch {
  display: none !important;
}
```

`dsh-cost-notch` 停用也不会影响新刘海的时间和费用；“费用设置”入口会跟着消失。费用每 60 秒刷新一次，切换会话时也会立即刷新。

## 主题是怎么实现的

DSH 的主题色是 CSS 自定义属性，运行时由布局插件把令牌写在 `body` 的行内样式里，所以普通选择器压不过它。这个插件分三块：

1. `lib/index.js`（宿主侧）
   - 监听 `webserver/index-inject`，往页面 `<body>` 开头插一段 `<style id="nitai-theme-css">`，再插一个 `<script src="/dsh-nitai-theme/client.js">`
   - 注册 `/dsh-nitai-theme/client.js`、`/dsh-nitai-theme/theme.css`、`/dsh-nitai-theme/state.json` 和 `/dsh-nitai-theme/health` 四个本地路由
   - 监听会话的 `assistant/message` 事件，用 `lib/pricing.js` 的价格表累计今日和本次会话的费用
   - 样式放在 body 而不是 head，保证晚于 DSH 自己的样式表加载

2. `lib/theme.css`（主题样式）
   - 用 `!important` 重定义中性色阶和关键语义令牌：背景、表面、文字、边框、品牌色、状态色、代码块、表格、菜单、输入框
   - 亮色写在 `body`，暗色写在 `body[data-ds-dark-theme]`，两档一一对应
   - 用两组合成的软阴影做拟态：凸起是“左上白影 + 右下灰影”，凹陷是把同一组影子翻到内侧
   - 侧栏、会话头部、标签、用户气泡、任务面板这些组件用精确类名选择器补齐，例如 `[class~="wtg9ga_root"]`、`[class~="an3WzG_tabActive"]`；用 `~=` 而不是 `*=`，是为了不把 `newSessionLabelMask` 这类子元素一起选中
   - 侧栏会话/工作区的悬停卡片原生固定是深色浮层，这里用 `[class*="_card"]:has(> [class~="wnFoaW_hoverContent"])` 改成跟随明暗的拟态卡片，并覆盖标题、时间、路径、状态文字的颜色
   - 侧栏、中心区和右栏共用同一张画布：三列容器透明，侧栏/右栏不再画竖直分界线；标签下划线、右栏按钮和“回到最新”按钮改成圆角，避免在统一底色上露出直角块
   - 只改令牌的值，不改令牌名，也不新增 DSH 没有的 L0 令牌
   - 没有 `url()`、`@import`、远程字体

3. `lib/layout-fix.css`（修正上游布局的独立补丁）
   - 只处理 Markdown 宽表：DSH 会把 4 列及以上的表格从正文列向两侧扩展到整个聊天区，容器内部可以横向滚动；滚动条平时隐藏，滚到最右端后表格会整体左移，看起来和正文对不齐
   - 这里把宽表收回到正文阅读列，表格宽度 100%、列宽按内容自动分配、超长路径在单元格内换行，不再产生横向滚动
   - 单独成文件，由 `lib/index.js` 的 `readThemeCss()` **始终**接在 `theme.css` 后面注入；`theme.css` 里也保留一份兼容副本，让已经运行的旧宿主立刻继续生效
   - 主题升级重新生成 `theme.css`、把副本冲掉后，layout-fix.css 仍然会被追加，修复不会静默消失
   - 选择器只用渲染器写死的 `md-table-wide` 语义类名，不含 `xMeOpW`、`_tableScroll_1ypvv_192` 这类带构建哈希的类名，升级 DSH 后仍然有效

4. `lib/client.js`（浏览器侧）
   - 创建 `#nt-notch`、面板和所有交互
   - 每秒更新时钟，每 60 秒拉一次费用，每 5 秒检查一次 `dsh-cost-notch` 是否出现
   - 用 `MutationObserver` 盯 `body` 的 `data-ds-dark-theme`，在用户明确选过模式后保持该模式不被外部改回去

5. `lib/pricing.js`（计价）
   - 和 `dsh-cost-notch` 使用同一套价格表和峰谷时段规则，单位是元/百万 token
   - 缓存写入按 miss 价计费，推理 token 已包含在输出 token 里，不重复计算

没有打包步骤，改完 `theme.css`、`layout-fix.css` 或 `client.js` 刷新页面就能看到；如果改的是宿主 `lib/index.js` 或新增了路由，就要完全退出桌面端再打开。

### 宽表排版修复为什么单独成文件

DSH 的宽表问题是“设计行为 + 横向滚动位置”叠加出来的：4 列及以上的表格会突破 920px 的正文列，容器可以横向滚动，但滚动条平时隐藏；一旦滚到最右端，表格就会整体左移一百多像素，和正文对不齐。

在 1920px 宽的窗口里复现并实测的数值：

| 项目 | 修复前 | 修复后 |
|---|---|---|
| 宽表容器宽度 | 1566px（正文列 920px，两侧各多出 323px） | 920px |
| 表格内容宽度 | 1411px（可横向滚动 168px） | 920px |
| 横向溢出 | 168px | 0 |
| 与正文左缘的关系 | 初始对齐，滚到最右后整体左移约 168px | 始终对齐 |

这段修复如果只放在 `theme.css` 末尾，下次重新生成或替换主题主体时很容易被一起覆盖。所以除了 `theme.css` 里的兼容副本，还单独保存了一份 `lib/layout-fix.css`；宿主读取样式时会**始终**把 `layout-fix.css` 接在 `theme.css` 后面。两份规则目前相同，重复不会改变结果，但以后主题升级把 `theme.css` 里的副本冲掉时，独立文件仍然生效。以后再加类似的“修正 DSH 上游布局”的规则，也直接放进这个文件。

自检命令：

```powershell
& 'C:\Users\18385\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\18385\Documents\dsh\nitai-theme\tools\check-theme.mjs'
```

命令会检查四件事：`layout-fix.css` 是否存在、宽表规则是否齐全、有没有误用带构建哈希的类名、宿主是否把 `layout-fix.css` 加进了注入列表。任何一项丢失都会报错退出，避免升级后静默失效。

## 目录

```
nitai-theme/
├─ package.json          插件清单，声明 dsh.bundle.patch
├─ cordis.patch.yml      把插件插进 Cordis 组合
├─ lib/
│  ├─ index.js           宿主侧注入、费用记账和本地路由
│  ├─ pricing.js         计价与峰谷时段
│  ├─ theme.css          明暗两套令牌与组件样式
│  ├─ layout-fix.css     宽表排版修复（独立保存，避免被主题升级覆盖）
│  └─ client.js          刘海、面板、主题切换
├─ tools/                开发与自检脚本
│  └─ check-theme.mjs    检查宽表修复是否还在
├─ preview.html          不启动 DSH 的独立预览页
├─ docs/                 截图
└─ README.md
```

## 本地预览

直接双击 `preview.html`，或：

```powershell
Start-Process 'C:\Users\18385\Documents\dsh\nitai-theme\preview.html'
```

预览页里带了一份假费用数据（今日 ¥3.42、会话 ¥5.10、余额 ¥106.62），刘海和面板的行为与真实页面一致。

## 在隔离环境里验证（不碰正在用的 DSH）

```powershell
$env:DSH_HOME='C:\Users\18385\Documents\dsh\nitai-theme\.dsh-home'
& 'D:\software\deepseek-harness\resources\runtime\cli\bin\dsh.cmd' web --port 0 --no-open
```

隔离 profile 里已经建好 `node_modules\dsh-nitai-theme` 链接，并把插件写进了 bundles。启动后按提示打开带 token 的地址即可。

## 卸载 / 回滚

1. 关掉桌面端。
2. 把 `.dsh\profiles\desktop\package.json.bak-nitai` 复制回 `package.json`。
3. 删除 `.dsh\profiles\desktop\node_modules\dsh-nitai-theme` 这个目录链接。
4. 重启桌面端。

只删链接、不改 `package.json` 会让 DSH 启动时找不到包；两步要一起做。

## 已知边界

- 已经在隔离的 Web UI 里验证过亮色、暗色、面板、侧栏、会话列表和费用记账；桌面窗口的标题栏与刘海的叠放还没有在桌面窗口里截图确认，重启后才能看到最终位置。
- 桌面端已经装好插件，但宿主代码不会热加载。只改 `theme.css`、`layout-fix.css` 或 `client.js` 时刷新页面即可；改 `lib/index.js` 或新增路由后，要完全退出 DeepSeek Harness 再打开。
- 刘海固定 `top: 8px`，按 40px 的 Windows 标题栏估算。如果桌面端的标题栏高度不同，改 `lib/theme.css` 里 `#nt-notch` 的 `top` 即可。
- 主题只覆盖了 DSH 常用界面。极少数第三方插件自己写死的颜色不会跟着变。
- 侧栏、会话头部这些组件用的是 `[class~="模块_类名"]` 精确类名选择器；DSH 升级后如果改了 CSS module 的类名前缀，对应的覆盖会失效，令牌部分不受影响。
- `prefers-reduced-motion` 下会关掉过渡动画。
