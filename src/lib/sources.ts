import { getTree, removeWithUndo, type BNode } from './bookmarks'

export type Source = 'bookmark' | 'tab'

/** One card on screen: a bookmark or an open tab inside a tab group. */
export interface Item {
  /** Unique per source entry: "b:<bookmarkId>" or "t:<tabId>". */
  key: string
  source: Source
  title: string
  url: string
  /** Collection key of the direct container. */
  container: string
  /** Collection keys from the top down to the direct container. */
  ancestors: string[]
  dateAdded: number
  order: number
  bookmarkId?: string
  tabId?: number
  windowId?: number
  discarded?: boolean
  loaded?: boolean
}

export interface Collection {
  /** "b:<folderId>" for bookmark folders, "g:<title>" for tab groups (group ids change on restart). */
  key: string
  source: Source
  title: string
  color?: chrome.tabGroups.ColorEnum
  parentKey?: string
  depth: number
  /** Items here and in nested collections. */
  count: number
  children: string[]
  bookmarkId?: string
  groupIds?: number[]
  windowIds?: number[]
}

export interface Snapshot {
  items: Item[]
  collections: Map<string, Collection>
  groupKeys: string[]
  bookmarkRoots: string[]
}

const groupKey = (g: chrome.tabGroups.TabGroup) => (g.title?.trim() ? `g:${g.title.trim()}` : `g:#${g.id}`)

export async function loadSnapshot(): Promise<Snapshot> {
  const [tree, groups, tabs] = await Promise.all([getTree(), chrome.tabGroups.query({}), chrome.tabs.query({})])
  const items: Item[] = []
  const collections = new Map<string, Collection>()

  // ---- tab groups (same title in several windows = one collection)
  const groupKeys: string[] = []
  const byGroupId = new Map<number, Collection>()
  for (const g of groups) {
    const key = groupKey(g)
    let c = collections.get(key)
    if (!c) {
      c = { key, source: 'tab', title: g.title?.trim() || 'Без названия', color: g.color, depth: 0, count: 0, children: [], groupIds: [], windowIds: [] }
      collections.set(key, c)
      groupKeys.push(key)
    }
    c.groupIds!.push(g.id)
    c.windowIds!.push(g.windowId)
    byGroupId.set(g.id, c)
  }
  const sortedTabs = [...tabs].sort((a, b) => a.windowId - b.windowId || a.index - b.index)
  // tabGroups.query returns groups in creation order; the sidebar should follow the tab strip
  const firstPos = new Map<string, number>()
  sortedTabs.forEach((t, i) => {
    const c = byGroupId.get(t.groupId)
    if (c && !firstPos.has(c.key)) firstPos.set(c.key, i)
  })
  groupKeys.sort((a, b) => (firstPos.get(a) ?? Infinity) - (firstPos.get(b) ?? Infinity))
  sortedTabs.forEach((t, i) => {
    const c = byGroupId.get(t.groupId)
    const url = t.url || t.pendingUrl
    if (!c || !url || t.id == null) return
    c.count++
    items.push({
      key: `t:${t.id}`,
      source: 'tab',
      title: t.title || url,
      url,
      container: c.key,
      ancestors: [c.key],
      dateAdded: (t as { lastAccessed?: number }).lastAccessed ?? 0,
      order: i,
      tabId: t.id,
      windowId: t.windowId,
      discarded: t.discarded,
      loaded: t.status === 'complete' && !t.discarded,
    })
  })

  // ---- bookmark folders
  const bookmarkRoots: string[] = []
  const walk = (n: BNode, parentKey: string | undefined, anc: string[], depth: number): number => {
    const key = `b:${n.id}`
    const c: Collection = { key, source: 'bookmark', title: n.title, parentKey, depth, count: 0, children: [], bookmarkId: n.id }
    collections.set(key, c)
    n.children?.forEach((ch, i) => {
      if (ch.url) {
        c.count++
        items.push({ key: `b:${ch.id}`, source: 'bookmark', title: ch.title, url: ch.url, container: key, ancestors: [...anc, key], dateAdded: ch.dateAdded ?? 0, order: i, bookmarkId: ch.id })
      } else {
        c.children.push(`b:${ch.id}`)
        c.count += walk(ch, key, [...anc, key], depth + 1)
      }
    })
    return c.count
  }
  for (const top of tree.children ?? []) {
    walk(top, undefined, [], 0)
    bookmarkRoots.push(`b:${top.id}`)
  }

  return { items, collections, groupKeys, bookmarkRoots }
}

/** Reload the snapshot whenever bookmarks, tabs or tab groups change (debounced). */
export function subscribeSources(cb: () => void) {
  let t: number | undefined
  const h = () => {
    clearTimeout(t)
    t = window.setTimeout(cb, 400)
  }
  const onTabUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
    if (info.url || info.title || info.groupId !== undefined || info.status === 'complete' || info.discarded !== undefined) h()
  }
  const b = chrome.bookmarks
  const tb = chrome.tabs
  const g = chrome.tabGroups
  const events = [
    b.onCreated, b.onRemoved, b.onChanged, b.onMoved, b.onChildrenReordered, b.onImportEnded,
    tb.onCreated, tb.onRemoved, tb.onMoved, tb.onAttached, tb.onDetached, tb.onReplaced,
    g.onCreated, g.onUpdated, g.onRemoved, g.onMoved,
  ] as chrome.events.Event<(...a: any[]) => void>[]
  events.forEach((e) => e.addListener(h))
  tb.onUpdated.addListener(onTabUpdated)
  return () => {
    events.forEach((e) => e.removeListener(h))
    tb.onUpdated.removeListener(onTabUpdated)
  }
}

export async function focusTab(item: Item) {
  if (item.tabId == null) return
  await chrome.tabs.update(item.tabId, { active: true })
  if (item.windowId != null) await chrome.windows.update(item.windowId, { focused: true })
}

/** Close a tab / delete a bookmark. Returns an undo function. */
export async function removeItem(item: Item): Promise<() => Promise<void>> {
  if (item.source === 'bookmark') return removeWithUndo(item.bookmarkId!)
  const tab = await chrome.tabs.get(item.tabId!)
  await chrome.tabs.remove(item.tabId!)
  return async () => {
    const created = await chrome.tabs.create({ url: tab.url || item.url, windowId: tab.windowId, index: tab.index, active: false })
    const groupAlive = tab.groupId !== -1 && (await chrome.tabGroups.get(tab.groupId).then(() => true, () => false))
    if (groupAlive) await chrome.tabs.group({ tabIds: created.id!, groupId: tab.groupId })
  }
}

/** Drag & drop between collections. Tab → folder copies it as a bookmark. */
export async function moveItem(item: Item, target: Collection) {
  if (target.source === 'bookmark') {
    if (item.source === 'bookmark') await chrome.bookmarks.move(item.bookmarkId!, { parentId: target.bookmarkId! })
    else await chrome.bookmarks.create({ parentId: target.bookmarkId!, title: item.title, url: item.url })
    return
  }
  const groupId = target.groupIds![0]
  if (item.source === 'tab') {
    await chrome.tabs.group({ tabIds: item.tabId!, groupId })
  } else {
    const created = await chrome.tabs.create({ url: item.url, windowId: target.windowIds![0], active: false })
    await chrome.tabs.group({ tabIds: created.id!, groupId })
  }
}

/**
 * Drag & drop inside a collection: put `item` right before/after `target` in Chrome itself
 * (tab strip order for tabs, folder order for bookmarks).
 */
export async function reorderItem(item: Item, target: Item, after: boolean) {
  if (item.key === target.key || item.source !== target.source) return
  if (item.source === 'bookmark') {
    const [t] = await chrome.bookmarks.get(target.bookmarkId!)
    // bookmarks.move counts the index as if the moved node were still in place, so no adjustment
    await chrome.bookmarks.move(item.bookmarkId!, { parentId: t.parentId, index: t.index! + (after ? 1 : 0) })
    return
  }
  const [a, t] = await Promise.all([chrome.tabs.get(item.tabId!), chrome.tabs.get(target.tabId!)])
  let index = t.index + (after ? 1 : 0)
  if (a.windowId === t.windowId && a.index < index) index -= 1 // tabs.move takes the final position
  await chrome.tabs.move(a.id!, { windowId: t.windowId, index })
  // landing on the group's edge can push the tab out of it — keep it in the target's group
  if (t.groupId !== -1) await chrome.tabs.group({ tabIds: a.id!, groupId: t.groupId })
}

export async function addUrl(url: string, target: Collection) {
  if (target.source === 'bookmark') return chrome.bookmarks.create({ parentId: target.bookmarkId!, title: url, url })
  const created = await chrome.tabs.create({ url, windowId: target.windowIds![0], active: false })
  await chrome.tabs.group({ tabIds: created.id!, groupId: target.groupIds![0] })
}

/**
 * Save a tab group as a bookmark folder under "Other bookmarks" (same title).
 * Re-running adds only the URLs that are not there yet. Returns how many were added.
 */
export async function saveGroupToBookmarks(group: Collection, items: Item[]): Promise<number> {
  const tree = await getTree()
  const other = tree.children?.find((c) => c.id === '2') ?? tree.children?.[1] ?? tree.children![0]
  let folder = other.children?.find((c) => !c.url && c.title === group.title)
  if (!folder) folder = (await chrome.bookmarks.create({ parentId: other.id, title: group.title })) as BNode
  const existing = new Set((await chrome.bookmarks.getChildren(folder.id)).map((c) => c.url))
  let added = 0
  for (const it of items) {
    if (existing.has(it.url)) continue
    await chrome.bookmarks.create({ parentId: folder.id, title: it.title, url: it.url })
    existing.add(it.url)
    added++
  }
  return added
}
