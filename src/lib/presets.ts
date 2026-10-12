import type { Preset } from './types'

const globRe = (g: string) =>
  new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')

/**
 * "site.com"          → site.com and its subdomains
 * "*.site.com"        → host glob
 * "site.com/game/*"   → URL glob (scheme optional)
 */
export function matchPattern(pattern: string, url: string): boolean {
  const p = pattern.trim()
  if (!p) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (!p.includes('/')) {
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    const ph = p.replace(/^www\./, '').toLowerCase()
    if (ph.includes('*')) return globRe(ph).test(host)
    return host === ph || host.endsWith('.' + ph)
  }
  const re = globRe(/^[a-z*]+:\/\//i.test(p) ? p : '*://' + p.replace(/^www\./, ''))
  return re.test(url) || re.test(url.replace('://www.', '://'))
}

export const findPreset = (url: string, presets: Preset[]) => presets.find((p) => p.enabled && matchPattern(p.match, url))

/** Default match for a new preset: host + first path segment when the URL is deeper than that. */
export function suggestMatch(url: string) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const segs = u.pathname.split('/').filter(Boolean)
    return segs.length > 1 ? `${host}/${segs[0]}/*` : host
  } catch {
    return ''
  }
}
