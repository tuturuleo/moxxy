// Generates public/icons/{16,48,128}.png (2×2 card grid on a dark rounded square) without dependencies.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

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
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function icon(size) {
  const S = 4 // supersampling
  const raw = Buffer.alloc(size * (size * 4 + 1))
  const u = size / 16
  const tiles = [
    [3.5, 3.5, 7.5, 7.5, [198, 244, 50]],
    [8.5, 3.5, 12.5, 7.5, [233, 233, 236]],
    [3.5, 8.5, 7.5, 12.5, [233, 233, 236]],
    [8.5, 8.5, 12.5, 12.5, [233, 233, 236]],
  ]
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S
          let col = null
          if (inRoundRect(px, py, 0.5 * u, 0.5 * u, size - 0.5 * u, size - 0.5 * u, 3.5 * u)) col = [22, 23, 27]
          for (const [x0, y0, x1, y1, c] of tiles) if (inRoundRect(px, py, x0 * u, y0 * u, x1 * u, y1 * u, 1.1 * u)) col = c
          if (col) (r += col[0]), (g += col[1]), (b += col[2]), a++
        }
      const o = y * (size * 4 + 1) + 1 + x * 4
      const n = S * S
      raw[o] = a ? r / a : 0
      raw[o + 1] = a ? g / a : 0
      raw[o + 2] = a ? b / a : 0
      raw[o + 3] = (a / n) * 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync('public/icons', { recursive: true })
for (const s of [16, 48, 128]) writeFileSync(`public/icons/${s}.png`, icon(s))
console.log('icons written')
