export interface BNode {
  id: string
  title: string
  url?: string
  parentId?: string
  index?: number
  dateAdded?: number
  children?: BNode[]
}

export async function getTree(): Promise<BNode> {
  const [root] = await chrome.bookmarks.getTree()
  return root as BNode
}

/** Deleting via Chrome is permanent, so snapshot the subtree first to be able to undo. */
export async function removeWithUndo(id: string): Promise<() => Promise<void>> {
  const [node] = (await chrome.bookmarks.getSubTree(id)) as BNode[]
  if (node.url) await chrome.bookmarks.remove(id)
  else await chrome.bookmarks.removeTree(id)
  return async () => {
    const restore = async (n: BNode, parentId: string, index?: number) => {
      const created = await chrome.bookmarks.create({ parentId, index, title: n.title, url: n.url })
      for (const c of n.children ?? []) await restore(c, created.id)
    }
    await restore(node, node.parentId!, node.index)
  }
}

export const faviconUrl = (pageUrl: string, size = 32) =>
  chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`)

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
