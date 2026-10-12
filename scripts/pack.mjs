// Packs dist/ into release/moxxy-<version>.zip (what you install / attach to a GitHub release).
// Dependency-free zip writer: deflate entries + central directory.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const root = join(import.meta.dirname, '..')
const dist = join(root, 'dist')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
if (manifest.version !== version) {
  console.error(`dist/manifest.json is ${manifest.version}, package.json is ${version} — run "npm run build" first`)
  process.exit(1)
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    statSync(p).isDirectory() ? walk(p) : files.push(p)
  }
}
walk(dist)

const local = []
const central = []
let offset = 0
for (const file of files) {
  const name = Buffer.from(relative(dist, file).split('\\').join('/'))
  const data = readFileSync(file)
  const packed = deflateRawSync(data, { level: 9 })
  const crc = crc32(data)
  const head = Buffer.alloc(30)
  head.writeUInt32LE(0x04034b50, 0)
  head.writeUInt16LE(20, 4) // version needed
  head.writeUInt16LE(0x0800, 6) // utf-8 names
  head.writeUInt16LE(8, 8) // deflate
  head.writeUInt32LE(crc, 14)
  head.writeUInt32LE(packed.length, 18)
  head.writeUInt32LE(data.length, 22)
  head.writeUInt16LE(name.length, 26)
  local.push(head, name, packed)

  const dir = Buffer.alloc(46)
  dir.writeUInt32LE(0x02014b50, 0)
  dir.writeUInt16LE(20, 4)
  dir.writeUInt16LE(20, 6)
  dir.writeUInt16LE(0x0800, 8)
  dir.writeUInt16LE(8, 10)
  dir.writeUInt32LE(crc, 16)
  dir.writeUInt32LE(packed.length, 20)
  dir.writeUInt32LE(data.length, 24)
  dir.writeUInt16LE(name.length, 28)
  dir.writeUInt32LE(offset, 42)
  central.push(dir, name)
  offset += head.length + name.length + packed.length
}
const centralBuf = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralBuf.length, 12)
end.writeUInt32LE(offset, 16)

mkdirSync(join(root, 'release'), { recursive: true })
const out = join(root, 'release', `moxxy-${version}.zip`)
writeFileSync(out, Buffer.concat([...local, centralBuf, end]))
console.log(`${relative(root, out)} — ${files.length} files`)
