import type { CardData } from './types'

// IndexedDB: parsed card data (keyed by url) and the local image cache
// (downscaled covers + their dominant color, keyed by image url).
let dbPromise: Promise<IDBDatabase> | undefined

export interface Thumb {
  blob: Blob
  color?: string
}

function open() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('moxxy', 3)
    r.onupgradeneeded = (e) => {
      const db = r.result
      if (e.oldVersion < 1) db.createObjectStore('cards', { keyPath: 'id' })
      if (e.oldVersion < 3) {
        // v1/v2 kept full-size hotlink fallbacks and colors separately; replaced by "thumbs"
        for (const old of ['images', 'colors']) if (db.objectStoreNames.contains(old)) db.deleteObjectStore(old)
        db.createObjectStore('thumbs')
      }
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }))
}

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function store(name: 'cards' | 'thumbs', mode: IDBTransactionMode) {
  return (await open()).transaction(name, mode).objectStore(name)
}

export const db = {
  allCards: async () => req<CardData[]>((await store('cards', 'readonly')).getAll()),
  putCard: async (c: CardData) => void (await req((await store('cards', 'readwrite')).put(c))),
  deleteCards: async (ids: string[]) => {
    const s = await store('cards', 'readwrite')
    await Promise.all(ids.map((id) => req(s.delete(id))))
  },
  getThumb: async (url: string) => req<Thumb | undefined>((await store('thumbs', 'readonly')).get(url)),
  putThumb: async (url: string, t: Thumb) => void (await req((await store('thumbs', 'readwrite')).put(t, url))),
  clearThumbs: async () => void (await req((await store('thumbs', 'readwrite')).clear())),
}
