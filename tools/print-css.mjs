import fs from 'node:fs'

const file = process.argv[2]
const pattern = process.argv[3] ? new RegExp(process.argv[3]) : null
if (!file) {
  console.error('usage: node tools/print-css.mjs <file> [regex]')
  process.exit(1)
}
const source = fs.readFileSync(file, 'utf8')
const match = source.match(/const css = "((?:[^"\\]|\\.)*)";/)
if (!match) {
  console.error('css literal not found')
  process.exit(1)
}
const css = JSON.parse(`"${match[1]}"`)
const rules = css.split('}').map((part) => `${part.trim()}}`)
for (const rule of rules) {
  if (!pattern || pattern.test(rule)) console.log(rule)
}
