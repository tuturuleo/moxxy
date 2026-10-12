import type { Kind, Preset } from './types'

export interface Settings {
  presets: Preset[]
  /** Card format per collection key ("g:<group title>" / "b:<folder id>"). */
  folderKinds: Record<string, Kind>
  cardSize: number
  includeNested: boolean
  lastCollection?: string
  staleDays: number
  titleSource: 'bookmark' | 'page'
  sort: 'chrome' | 'new' | 'old' | 'title' | 'downloaded'
  /** Show all / only downloaded / only not downloaded cards. */
  markFilter: 'all' | 'done' | 'todo'
  /** cover = crop to fill the card; contain = whole image, empty space filled with its dominant color.
   *  Default for collections without their own choice in `folderFits`. */
  imageFit: 'cover' | 'contain'
  /** Image fit per collection key, like folderKinds. */
  folderFits: Record<string, 'cover' | 'contain'>
}

export const DEFAULT_SETTINGS: Settings = {
  presets: [],
  folderKinds: {},
  cardSize: 220,
  includeNested: false,
  staleDays: 30,
  titleSource: 'bookmark',
  sort: 'chrome',
  markFilter: 'all',
  imageFit: 'cover',
  folderFits: {},
}

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get('settings')
  return { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) }
}

export async function saveSettings(s: Settings) {
  await chrome.storage.local.set({ settings: s })
}

/** Presets saved by the picker while no Moxxy tab was open to receive them. */
export async function takePickerInbox(): Promise<Preset[]> {
  const r = await chrome.storage.local.get('pickerInbox')
  const list: Preset[] = r.pickerInbox ?? []
  if (list.length) await chrome.storage.local.remove('pickerInbox')
  return list
}
