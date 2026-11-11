// Minimal ASAR reader used while developing the theme. It reads the archive
// header and can list files or write one entry to disk without external packages.
import fs from 'node:fs'
import path from 'node:path'

function readHeader (archive) {
  const fd = fs.openSync(archive, 'r')
  try {
    const base = Buffer.alloc(16)
    fs.readSync(fd, base, 0, 16, 0)
    const headerSize = base.readUInt32LE(4)
    const jsonSize = base.readUInt32LE(12)
    const json = Buffer.alloc(jsonSize)
    fs.readSync(fd, json, 0, jsonSize, 16)
    return { fd, header: JSON.parse(json.toString('utf8')), dataStart: 8 + headerSize }
  } catch (err) {
    fs.closeSync(fd)
    throw err
  }
}

function walk (node, prefix, out) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const full = prefix ? prefix + '/' + name : name
    if (child.files) walk(child, full, out)
    else out.push({ path: full, size: child.size, offset: String(child.offset) })
  }
}

const [, , cmd, archive, arg] = process.argv
const { fd, header, dataStart } = readHeader(archive)
try {
  if (cmd === 'list') {
    const out = []
    walk(header, '', out)
    const filter = arg ? new RegExp(arg, 'i') : null
    for (const f of out) if (!filter || filter.test(f.path)) console.log(f.size + '\t' + f.path)
  } else if (cmd === 'extract') {
    const out = []
    walk(header, '', out)
    const wanted = out.filter(f => f.path === arg || f.path.startsWith(arg.replace(/\/$/, '') + '/'))
    if (!wanted.length) throw new Error('no entry matches ' + arg)
    for (const f of wanted) {
      const target = path.join(process.cwd(), '.asar-extract', f.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      const buf = Buffer.alloc(f.size)
      fs.readSync(fd, buf, 0, f.size, dataStart + Number(f.offset))
      fs.writeFileSync(target, buf)
      console.log(target)
    }
  } else {
    console.log('usage: node asar.mjs list <archive> [regex] | extract <archive> <path>')
  }
} finally {
  fs.closeSync(fd)
}
