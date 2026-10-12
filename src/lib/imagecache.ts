import { db } from './db'

// Local cover cache: each image is downloaded once by the extension (with the user's cookies,
// so hotlink protection doesn't matter), downscaled to card size and stored in IndexedDB together
// with its dominant color, computed from the same decoded bitmap. Afterwards covers load from disk.

export interface CachedImage {
  /** object URL of the cached blob */
  url: string
  color?: string
}

const MAX_SIDE = 800
const MAX_PARALLEL = 6
const TIMEOUT_MS = 15000

const mem = new Map<string, Promise<CachedImage | null>>()
let active = 0
const waiters: (() => void)[] = []

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}

/** null = couldn't cache (the card then tries a plain <img>). */
export function cachedImage(src: string): Promise<CachedImage | null> {
  let p = mem.get(src)
  if (!p) {
    p = load(src).catch(() => null)
    mem.set(src, p)
  }
  return p
}

export async function clearImageCache() {
  for (const p of mem.values()) p.then((c) => c && URL.revokeObjectURL(c.url))
  mem.clear()
  await db.clearThumbs()
}

async function load(src: string): Promise<CachedImage> {
  const hit = await db.getThumb(src)
  if (hit) return { url: URL.createObjectURL(hit.blob), color: hit.color }
  return slot(async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let blob: Blob
    try {
      const r = await fetch(src, { credentials: 'include', signal: ctrl.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      blob = await r.blob()
    } finally {
      clearTimeout(timer)
    }
    const bmp = await createImageBitmap(blob) // throws for non-images / svg → plain <img> fallback
    try {
      if (bmp.width < 40 || bmp.height < 40) throw new Error('tracking pixel / stub')
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
      const w = Math.round(bmp.width * scale)
      const h = Math.round(bmp.height * scale)

      const probe = new OffscreenCanvas(32, 32).getContext('2d', { willReadFrequently: true })!
      probe.drawImage(bmp, 0, 0, 32, 32)
      const color = dominantColor(probe.getImageData(0, 0, 32, 32).data)

      let out = blob
      if (scale < 1 || blob.size > 250_000) {
        const c = new OffscreenCanvas(w, h)
        c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
        out = await c.convertToBlob({ type: 'image/webp', quality: 0.85 })
      }
      await db.putThumb(src, { blob: out, color })
      return { url: URL.createObjectURL(out), color }
    } finally {
      bmp.close()
    }
  })
}

/** Most populated 3-bit-per-channel bucket, averaged inside the bucket. */
function dominantColor(d: Uint8ClampedArray): string {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    bin.n++
    bin.r += r
    bin.g += g
    bin.b += b
    bins.set(key, bin)
  }
  let best: { n: number; r: number; g: number; b: number } | undefined
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin
  if (!best) return 'rgb(27, 28, 32)'
  return `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})`
}
