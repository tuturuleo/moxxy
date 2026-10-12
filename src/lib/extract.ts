import type { Extracted, FieldDef, LabeledValue } from './types'

/**
 * Pulls card data out of a page: OpenGraph / meta / JSON-LD by default, then preset fields on top.
 *
 * MUST stay self-contained (no imports used at runtime, no outer variables): it is also passed to
 * chrome.scripting.executeScript, which serializes the function source and runs it inside the
 * site's tab. In that case docArg/baseArg are null and the live `document` is used.
 */
export function extractPage(docArg: Document | null, baseArg: string | null, fields: FieldDef[] | null): Extracted {
  const doc = docArg || document
  const live = !docArg
  let base = baseArg || location.href
  const baseEl = doc.querySelector('base[href]')
  if (baseEl) {
    try {
      base = new URL(baseEl.getAttribute('href') || '', base).href
    } catch {}
  }

  const clean = (s?: string | null) => {
    const t = (s || '').replace(/\s+/g, ' ').trim()
    return t || undefined
  }
  const cleanMulti = (s?: string | null) => {
    const t = (s || '')
      .split(/\n+/)
      .map((l) => l.replace(/[ \t\r\f\v]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
    return t ? t.slice(0, 3000) : undefined
  }
  const abs = (u?: string | null) => {
    const t = (u || '').trim()
    if (!t || /^javascript:/i.test(t) || t === '#') return undefined
    if (t.startsWith('data:') && t.length < 2000) return undefined // lazy-load placeholders
    try {
      return new URL(t, base).href
    } catch {
      return undefined
    }
  }
  const fromSrcset = (s?: string | null) => {
    if (!s) return undefined
    const parts = s.split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean)
    return parts[parts.length - 1]
  }

  const imgOf = (el: Element | null): string | undefined => {
    if (!el) return undefined
    const tag = el.tagName.toLowerCase()
    const a = (n: string) => el.getAttribute(n)
    if (tag === 'img') {
      const cur = (el as HTMLImageElement).currentSrc
      return abs(
        a('data-src') || a('data-lazy-src') || a('data-original') || fromSrcset(a('data-srcset')) ||
          (live && cur && !cur.startsWith('data:') ? cur : null) || fromSrcset(a('srcset')) || a('src'),
      )
    }
    if (tag === 'meta') return abs(a('content'))
    if (tag === 'source') return abs(fromSrcset(a('srcset')) || a('src'))
    if (tag === 'video' && a('poster')) return abs(a('poster'))
    if (tag === 'a' || tag === 'link') {
      const h = a('href')
      if (h && /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(h)) return abs(h)
    }
    const m = (a('style') || '').match(/background(?:-image)?\s*:[^;]*url\((['"]?)(.*?)\1\)/i)
    if (m) return abs(m[2])
    if (live) {
      try {
        const mm = getComputedStyle(el).backgroundImage.match(/url\((['"]?)(.*?)\1\)/)
        if (mm) return abs(mm[2])
      } catch {}
    }
    const inner = el.querySelector('img, video[poster], picture source')
    return inner ? imgOf(inner) : undefined
  }

  // Thumbnails usually carry the full-size address nearby: a data-* attribute or a lightbox link.
  // (The enlarged picture a site shows after a click doesn't exist in the page until then.)
  const FULL_ATTRS = ['data-full', 'data-full-src', 'data-fullsrc', 'data-src-full', 'data-large', 'data-large-src', 'data-zoom', 'data-zoom-src',
    'data-zoom-image', 'data-big', 'data-hires', 'data-highres', 'data-orig', 'data-original-src', 'data-image-full', 'data-pswp-src', 'data-lightbox-src']
  const LIGHTBOX = /lightbox|fancybox|glightbox|photoswipe|magnific|gallery|zoom|popup/i
  const fullImageOf = (el: Element): string | undefined => {
    const link = (el.tagName === 'A' ? el : el.closest('a[href]') || el.querySelector('a[href]')) as Element | null
    for (const node of [el, el.querySelector('img'), link]) {
      if (!node) continue
      for (const a of FULL_ATTRS) {
        const v = node.getAttribute(a)
        if (v) return abs(v)
      }
    }
    const href = link?.getAttribute('href')
    if (!href || href === '#' || /^javascript:/i.test(href)) return undefined
    if (/\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(href)) return abs(href)
    const marked =
      link!.hasAttribute('data-fancybox') || link!.hasAttribute('data-lightbox') || link!.hasAttribute('data-gallery') ||
      LIGHTBOX.test(link!.getAttribute('rel') || '') || LIGHTBOX.test(link!.getAttribute('class') || '')
    return marked ? abs(href) : undefined
  }
  /** Per-block "replace in address": plain text, or /regex/ (all matches). */
  const rewrite = (f: FieldDef, u?: string) => {
    if (!u || !f.replaceFrom) return u
    let out = u
    try {
      // "/…/" is a regex only if it uses regex syntax — a plain path like "/thumb/" is just text
      const m = f.replaceFrom.match(/^\/(.+)\/([a-z]*)$/)
      out = m && /[\\()[\]{}*+?^$|]/.test(m[1]) ? u.replace(new RegExp(m[1], m[2].includes('g') ? m[2] : m[2] + 'g'), f.replaceTo ?? '') : u.split(f.replaceFrom).join(f.replaceTo ?? '')
    } catch {}
    return abs(out)
  }

  const textOf = (el: Element, attr?: string) => {
    if (attr && attr !== 'text') return el.getAttribute(attr) || undefined
    return live && (el as HTMLElement).innerText !== undefined ? (el as HTMLElement).innerText : el.textContent || undefined
  }
  const linkOf = (el: Element, attr?: string) => {
    if (attr && attr !== 'text') return abs(el.getAttribute(attr))
    const a = el.closest('a[href]') || el.querySelector('a[href]')
    return abs(a?.getAttribute('href') ?? el.getAttribute('href') ?? el.getAttribute('data-href') ?? el.getAttribute('data-url'))
  }
  const meta = (...names: string[]) => {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`)
      const c = clean(el?.getAttribute('content'))
      if (c) return c
    }
    return undefined
  }

  // ---- JSON-LD: pick the most "content-like" object on the page
  const ld: any[] = []
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      const walk = (x: any) => {
        if (!x || typeof x !== 'object') return
        if (Array.isArray(x)) return x.forEach(walk)
        if (x['@graph']) walk(x['@graph'])
        if (x['@type']) ld.push(x)
      }
      walk(JSON.parse(s.textContent || ''))
    } catch {}
  })
  const types = (x: any) => ([] as unknown[]).concat(x['@type']).map(String)
  const preferred = ['Movie', 'TVSeries', 'TVSeason', 'TVEpisode', 'VideoGame', 'SoftwareApplication', 'Book', 'ComicSeries', 'CreativeWorkSeries', 'VideoObject', 'Product', 'Article', 'NewsArticle', 'BlogPosting', 'CreativeWork']
  let main: any
  for (const t of preferred) {
    main = ld.find((x) => types(x).includes(t))
    if (main) break
  }
  const ldStr = (v: any): string | undefined => {
    if (v == null) return undefined
    if (Array.isArray(v)) return ldStr(v[0])
    if (typeof v === 'object') return clean(v.name || v['@id'])
    return clean(String(v))
  }
  const ldImg = (v: any): string | undefined => {
    if (!v) return undefined
    if (typeof v === 'string') return abs(v)
    if (Array.isArray(v)) return ldImg(v[0])
    return abs(v.url || v.contentUrl)
  }

  const guessImage = () => {
    const root = doc.querySelector('main, article, [role=main], #content, .content') || doc.body
    if (!root) return undefined
    let best: string | undefined
    let bestScore = 0
    for (const im of Array.from(root.querySelectorAll('img')).slice(0, 80)) {
      const src = imgOf(im)
      if (!src || /\.svg(\?|$)/i.test(src)) continue
      const hint = `${src} ${im.getAttribute('class') || ''} ${im.getAttribute('alt') || ''}`.toLowerCase()
      if (/logo|icon|avatar|sprite|emoji|badge|pixel|spacer|1x1|banner/.test(hint)) continue
      const w = (im as HTMLImageElement).naturalWidth || parseInt(im.getAttribute('width') || '0')
      const h = (im as HTMLImageElement).naturalHeight || parseInt(im.getAttribute('height') || '0')
      if (w && h && (w < 120 || h < 90)) continue
      const score = w && h ? w * h : 40000
      if (score > bestScore) {
        bestScore = score
        best = src
      }
    }
    return best
  }
  const firstParagraph = () => {
    const root = doc.querySelector('article, main, [role=main]') || doc.body
    for (const p of Array.from(root?.querySelectorAll('p') || []).slice(0, 30)) {
      const t = clean(p.textContent)
      if (t && t.length > 80) return t.slice(0, 600)
    }
    return undefined
  }

  // ---- page defaults
  const out: Extracted = { badges: [], texts: [], presetHits: 0 }
  out.title = meta('og:title', 'twitter:title') || ldStr(main?.name) || clean(doc.querySelector('title')?.textContent) || clean(doc.querySelector('h1')?.textContent)
  out.siteName = meta('og:site_name', 'application-name')
  // Several cover candidates: a card falls back to the next one if an image refuses to load.
  const candidates: string[] = []
  const addCandidate = (u?: string) => u && !candidates.includes(u) && candidates.push(u)
  ;['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image', 'twitter:image:src'].forEach((n) => addCandidate(abs(meta(n))))
  addCandidate(ldImg(main?.image || main?.thumbnailUrl))
  addCandidate(imgOf(doc.querySelector('link[rel="image_src"]')))
  addCandidate(imgOf(doc.querySelector('[itemprop="image"]')))
  addCandidate(guessImage())
  out.images = candidates.slice(0, 6)
  out.image = candidates[0]
  const desc = meta('og:description', 'description', 'twitter:description') || ldStr(main?.description) || firstParagraph()
  out.description = desc && desc.slice(0, 3000)

  if (main) {
    const rating = main.aggregateRating?.ratingValue
    if (rating != null && rating !== '') out.badges.push({ label: 'Рейтинг', value: `★ ${rating}` })
    const year = ldStr(main.datePublished || main.dateCreated || main.startDate)?.match(/\d{4}/)?.[0]
    if (year) out.badges.push({ label: 'Год', value: year })
    const genre = ([] as any[]).concat(main.genre || []).slice(0, 3).map(ldStr).filter(Boolean).join(', ')
    if (genre) out.texts.push({ label: 'Жанр', value: genre })
    const author = ldStr(main.author || main.creator)
    if (author) out.texts.push({ label: 'Автор', value: author })
    const director = ldStr(main.director)
    if (director) out.texts.push({ label: 'Режиссёр', value: director })
  }

  // ---- preset blocks: each one is extracted independently; the card decides where to show it
  for (const f of fields || []) {
    if (!f.selector) continue
    let els: Element[]
    try {
      els = Array.from(doc.querySelectorAll(f.selector))
    } catch {
      els = []
    }
    if (!(f.all || f.type === 'gallery')) els = els.slice(0, 1)
    const values: string[] = []
    const links: LabeledValue[] = []
    const push = (v?: string) => v && !values.includes(v) && values.length < 40 && values.push(v)
    for (const el of els) {
      switch (f.type) {
        case 'image':
        case 'gallery': {
          const tag = el.tagName.toLowerCase()
          const inner = f.type === 'gallery' && tag !== 'img' && tag !== 'a' ? Array.from(el.querySelectorAll('img')) : []
          for (const im of inner.length > 1 ? inner : [el]) push(rewrite(f, f.attr ? abs(im.getAttribute(f.attr)) : fullImageOf(im) || imgOf(im)))
          break
        }
        case 'title':
        case 'badge':
          push(clean(textOf(el, f.attr)))
          break
        case 'description':
        case 'text':
          push(cleanMulti(textOf(el, f.attr)))
          break
        case 'action': {
          const u = linkOf(el, f.attr)
          if (!u || links.some((x) => x.value === u)) break
          // raw link text; the visible caption is built from the block's label at render time
          links.push({ label: (clean(el.textContent) || '').slice(0, 80), value: u })
          break
        }
      }
    }
    if (values.length || links.length) {
      ;(out.blocks ||= []).push(links.length ? { fieldId: f.id, values, links } : { fieldId: f.id, values })
      out.presetHits++
    } else (out.missed ||= []).push(f.type)
  }
  return out
}
