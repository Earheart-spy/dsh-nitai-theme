import fs from 'node:fs'

const file = '.asar-extract/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js'
const source = fs.readFileSync(file, 'utf8')
const match = source.match(/const css = "((?:[^"\\]|\\.)*)";/)
if (!match) {
  console.error('css literal not found')
  process.exit(1)
}
const css = JSON.parse(`"${match[1]}"`)
const rules = css.split('}').map((part) => `${part.trim()}}`)
for (const rule of rules) {
  if (/_root|_newSession|_panelRow|_panelActive|_panelList|_logoRow|_regionArea|_footArea|_toggle|_brand/.test(rule)) {
    console.log(rule)
  }
}
