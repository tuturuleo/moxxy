import { extractPage } from './extract'
import { findPreset } from './presets'
import { PARSE_VERSION, emptyExtracted, type CardData, type Extracted, type FieldDef, type Preset } from './types'

export const isParsable = (url: string) => /^https?:\/\//i.test(url)

/** Fetch with the user's cookies (host_permissions), decode the right charset, parse to a Document. */
async function fetchDoc(url: string): Promise<{ doc?: Document; base: string; imageUrl?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(url, {
      credentials: 'include',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct.startsWith('image/')) return { base: res.url, imageUrl: res.url }
    if (ct && !ct.includes('html') && !ct.includes('xml')) throw new Error(`не страница: ${ct.split(';')[0]}`)
    const buf = await res.arrayBuffer()
    // Plenty of RU sites are still windows-1251: honour header, then <meta charset>.
    let charset = ct.match(/charset=([\w-]+)/)?.[1]
    if (!charset) {
      const head = new TextDecoder('latin1').decode(buf.slice(0, 4096))
      charset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
    }
    let html: string
    try {
      html = new TextDecoder(charset || 'utf-8').decode(buf)
    } catch {
      html = new TextDecoder('utf-8').decode(buf)
    }
    return { doc: new DOMParser().parseFromString(html, 'text/html'), base: res.url || url }
  } finally {
    clearTimeout(timer)
  }
}

export function waitTabComplete(tabId: number, timeout: number) {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      resolve()
    }
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') finish()
    }
    chrome.tabs.onUpdated.addListener(listener)
    const timer = setTimeout(finish, timeout)
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && t.url !== 'about:blank' && finish(), finish)
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** executeScript can hang forever on a frozen/background tab — never let it stall the queue. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })
}

/** Open the page in a muted background tab, let its JS render, run the extractor inside. */
async function doTabExtract(url: string, fields: FieldDef[] | null): Promise<Extracted> {
  const tab = await chrome.tabs.create({ url, active: false })
  const tabId = tab.id!
  await trackParserTab(tabId, true)
  try {
    chrome.tabs.update(tabId, { muted: true }).catch(() => {})
    await waitTabComplete(tabId, 30000)
    await sleep(1500) // SPA hydration / lazy images
    const [r] = await withTimeout(chrome.scripting.executeScript({ target: { tabId }, func: extractPage, args: [null, null, fields] }), 15000, 'страница не ответила')
    if (!r?.result) throw new Error('не удалось прочитать вкладку')
    return r.result as Extracted
  } finally {
    chrome.tabs.remove(tabId).catch(() => {})
    trackParserTab(tabId, false)
  }
}

// Tabs opened for parsing are remembered, so ones left behind (Moxxy closed or reloaded mid-parse)
// get closed on the next start.
async function trackParserTab(tabId: number, add: boolean) {
  const r = await chrome.storage.local.get('parserTabs')
  const ids: number[] = r.parserTabs ?? []
  await chrome.storage.local.set({ parserTabs: add ? [...ids, tabId] : ids.filter((x) => x !== tabId) })
}

export async function closeLeftoverParserTabs() {
  const r = await chrome.storage.local.get('parserTabs')
  const ids: number[] = r.parserTabs ?? []
  if (!ids.length) return
  await Promise.all(ids.map((id) => chrome.tabs.remove(id).catch(() => {})))
  await chrome.storage.local.remove('parserTabs')
}

// One background tab at a time.
let tabChain: Promise<unknown> = Promise.resolve()
export function tabExtract(url: string, fields: FieldDef[] | null) {
  const p = tabChain.then(() => doTabExtract(url, fields))
  tabChain = p.catch(() => {})
  return p
}

export interface ParseOptions {
  /** Explicit user action: read the page in a background tab (⧉, «Догрузить пустые», constructor). */
  forceTab?: boolean
  /** User asked for this card right now (↻): a preset marked "через вкладку" may open a tab. */
  interactive?: boolean
  /** The page is already open in this tab: read it right there (rendered, logged in). */
  liveTabId?: number
  /** Use this preset regardless of match/enabled (preset editor "test"). */
  preset?: Preset
}

export async function parseUrl(url: string, presets: Preset[], opts: ParseOptions = {}): Promise<Omit<CardData, 'id'>> {
  if (!isParsable(url)) return { url, status: 'skip', parsedAt: Date.now() }
  const preset = opts.preset ?? findPreset(url, presets)
  const fields = preset?.fields.length ? preset.fields : null
  // A tab is opened only on the user's request — never by background parsing.
  const useTab = !!opts.forceTab || (preset?.mode === 'tab' && !!opts.interactive)

  let data: Extracted | undefined
  let via: 'fetch' | 'tab' = 'fetch'
  let fetchErr: unknown
  if (opts.liveTabId != null) {
    try {
      const [r] = await withTimeout(chrome.scripting.executeScript({ target: { tabId: opts.liveTabId }, func: extractPage, args: [null, null, fields] }), 8000, 'вкладка не ответила')
      if (r?.result) {
        data = r.result as Extracted
        via = 'tab'
      }
    } catch {
      // discarded / restricted tab: fall through to the normal path
    }
  }
  if (!data && !useTab) {
    try {
      const r = await fetchDoc(url)
      data = r.imageUrl ? { ...emptyExtracted(), image: r.imageUrl } : extractPage(r.doc!, r.base, fields)
    } catch (e) {
      fetchErr = e
    }
  }
  if (useTab && via !== 'tab') {
    try {
      data = await tabExtract(url, fields)
      via = 'tab'
    } catch (e) {
      if (!data) throw e
    }
  }
  if (!data) throw fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr))
  return {
    url,
    v: PARSE_VERSION,
    status: data.image || data.description || data.blocks?.length ? 'ok' : 'weak',
    data,
    parsedAt: Date.now(),
    presetId: preset?.id,
    via,
  }
}

/** Open a site in a foreground tab with the visual selector picker injected. */
export async function launchPicker(url: string, preset?: Preset) {
  const tab = await chrome.tabs.create({ url, active: true })
  const tabId = tab.id!
  await waitTabComplete(tabId, 30000)
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (init: unknown) => {
      ;(window as any).__moxxyPickerInit = init
    },
    args: [{ preset: preset ?? null }],
  })
  await chrome.scripting.executeScript({ target: { tabId }, files: ['picker.js'] })
}
