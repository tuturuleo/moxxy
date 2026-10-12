import type { Item } from './sources'

/** Pseudo-collection key of the "Duplicates" view in the sidebar. */
export const DUPES = '__dupes'

const TRACKING = /^(utm_\w+|fbclid|gclid|yclid|ysclid|_openstat|mc_cid|mc_eid|ref|ref_src|from)$/i

/** Same page = same normalized URL: no #hash, no tracking params, no www., no trailing slash, sorted query. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b))
    const query = params.length ? '?' + new URLSearchParams(params).toString() : ''
    const path = u.pathname.replace(/\/+$/, '') || '/'
    return `${u.protocol}//${u.hostname.toLowerCase().replace(/^www\./, '')}${u.port ? ':' + u.port : ''}${path}${query}`
  } catch {
    return url
  }
}

/** "2 раза", "5 раз", "22 раза" */
export const times = (n: number) => `${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'раза' : 'раз'}`

export interface DupeGroup {
  key: string
  items: Item[]
}

/** Open tabs (in tab groups) that point at the same page. Bookmarks are not counted. */
export function findDupes(items: Item[]): { groups: DupeGroup[]; byItem: Map<string, DupeGroup> } {
  const map = new Map<string, Item[]>()
  for (const it of items) {
    if (it.source !== 'tab' || !/^https?:/i.test(it.url)) continue
    const key = normalizeUrl(it.url)
    map.set(key, [...(map.get(key) ?? []), it])
  }
  const groups: DupeGroup[] = []
  const byItem = new Map<string, DupeGroup>()
  for (const [key, list] of map) {
    if (list.length < 2) continue
    const g = { key, items: list }
    groups.push(g)
    for (const it of list) byItem.set(it.key, g)
  }
  return { groups, byItem }
}
