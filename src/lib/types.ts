export type Kind = 'watch' | 'play' | 'read' | 'default'

/** What a preset block extracts and how the card shows it. */
export type FieldType = 'image' | 'gallery' | 'title' | 'description' | 'text' | 'badge' | 'action'

/** Slide a block goes to: 0 = cover, 1..N = custom slides, -1 = actions slide, undefined = auto by type. */
export type SlideRef = number | undefined
export const ACTIONS_SLIDE = -1

/** One block of the card constructor: where to find it on the page + where to show it. */
export interface FieldDef {
  id: string
  label: string
  type: FieldType
  selector: string
  /** Attribute to read instead of the automatic value (text / src / href). */
  attr?: string
  /** Use every match instead of the first one. */
  all?: boolean
  slide?: SlideRef
  /** Images only: replace in the address (e.g. "/thumb/" → "/full/"); "/regex/" allowed. */
  replaceFrom?: string
  replaceTo?: string
}

/** auto = plain request first, background tab if the preset blocks came back empty. */
export type PresetMode = 'auto' | 'fetch' | 'tab'

export interface Preset {
  id: string
  name: string
  /** "site.com", "*.site.com" or a URL glob like "site.com/game/*". */
  match: string
  mode: PresetMode
  enabled: boolean
  fields: FieldDef[]
  /** Number of custom slides between the cover and the auto/actions slides. */
  slideCount?: number
}

export interface LabeledValue {
  label: string
  value: string
}

/** What one preset block found on the page. Layout (slide, label, type) is read from the preset at render time. */
export interface BlockData {
  fieldId: string
  /** Image urls or text values. */
  values: string[]
  /** For action blocks: label → url. */
  links?: LabeledValue[]
}

export interface Extracted {
  // ---- page defaults (OpenGraph / meta / JSON-LD)
  title?: string
  /** Best cover (= images[0]). */
  image?: string
  /** Cover candidates in priority order; the card falls back through them. */
  images?: string[]
  description?: string
  siteName?: string
  badges: LabeledValue[]
  texts: LabeledValue[]
  // ---- preset blocks
  blocks?: BlockData[]
  /** How many preset blocks produced a value. */
  presetHits: number
  /** Types of preset blocks that found nothing. */
  missed?: FieldType[]
}

export type CardStatus = 'ok' | 'weak' | 'error' | 'skip'

/** Parsed page data, cached per URL (a bookmark and a tab with the same URL share it). */
export interface CardData {
  /** = url */
  id: string
  url: string
  status: CardStatus
  data?: Extracted
  error?: string
  parsedAt: number
  presetId?: string
  via?: 'fetch' | 'tab'
  /** Parser format version; older entries get re-parsed. */
  v?: number
}

export const PARSE_VERSION = 2

export const emptyExtracted = (): Extracted => ({ badges: [], texts: [], presetHits: 0 })

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
