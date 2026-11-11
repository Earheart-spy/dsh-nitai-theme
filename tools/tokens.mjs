// Extracts the built-in token stylesheets from the theme runtime bundle so the
// theme can be designed against the real variable names instead of guesses.
import fs from 'node:fs'

const src = fs.readFileSync('.asar-extract/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js', 'utf8')

function literalAfter (name) {
  const at = src.indexOf('var ' + name + ' = ')
  if (at < 0) throw new Error('missing ' + name)
  const start = src.indexOf('"', at)
  let i = start + 1
  let out = ''
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') { out += src[i] + src[i + 1]; i += 2; continue }
    if (ch === '"') break
    out += ch
    i++
  }
  return JSON.parse('"' + out + '"')
}

const names = process.argv.slice(2)
for (const name of names) {
  const css = literalAfter(name)
  console.log('/* ===== ' + name + ' ===== */')
  console.log(css.replace(/;/g, ';\n').replace(/\{/g, '{\n').replace(/\}/g, '\n}\n'))
}
