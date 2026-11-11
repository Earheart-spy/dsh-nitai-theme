import fs from 'node:fs'

const file = 'C:/Users/18385/Documents/dsh/nitai-theme/lib/theme.css'
let css = fs.readFileSync(file, 'utf8')

/*
 * 主题样式里原本有中文说明，但经过一次 PowerShell 转码后变成了乱码。
 * 这里把所有块注释去掉，再在关键分段前写回新的说明，避免把乱码留在交付文件里。
 */
css = css.replace(/\/\*[\s\S]*?\*\//g, '')

const header = `/*
 * 拟态主题样式：亮色令牌写在 body，暗色令牌写在 body[data-ds-dark-theme]，
 * 组件覆盖放在文件后半段。大量使用 !important 是因为布局插件会把令牌写成
 * body 的行内样式，普通规则压不过行内样式。
 */

`

const sidebarComment = `/*
 * 侧栏：整块用浅色渐变和内缘高光，新建按钮、导航行、选中的会话行都浮起来。
 * 选择器用 [class~="模块_类名"] 精确匹配整个类名，避免把 newSessionLabelMask
 * 这类子元素一起选中。
 */
`
css = css.replace('[class~="wtg9ga_root"] {', sidebarComment + '[class~="wtg9ga_root"] {')

const headerComment = `/*
 * 会话头部：标签条做成凹槽，选中的标签浮起并换成品牌色。
 */
`
css = css.replace('[class~="an3WzG_header"] {', headerComment + '[class~="an3WzG_header"] {')

const notchComment = `/*
 * 顶部刘海和展开面板。刘海固定在窗口顶部中间，面板从刘海下方展开。
 */
`
css = css.replace('#nt-notch {', notchComment + '#nt-notch {')

fs.writeFileSync(file, header + css, 'utf8')
console.log('comment cleanup done, bytes=' + fs.statSync(file).size)
