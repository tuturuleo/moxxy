import { ACTIONS_SLIDE, type Extracted, type FieldDef, type FieldType, type LabeledValue, type Preset } from './types'

// A card has exactly three views: cover (default) → hover → actions (right click / "⋯").

export type View = 0 | 1 | 2
export const COVER: View = 0
export const HOVER: View = 1
export const ACTIONS: View = 2
export const VIEW_NAMES: Record<View, string> = { 0: 'Обложка', 1: 'При наведении', 2: 'Действия' }

/** A block ready to render: extracted values + presentation from the (current) preset. */
export interface RBlock {
  id: string
  type: FieldType
  label: string
  values: string[]
  links?: LabeledValue[]
}

export interface CardLayout {
  cover: { images: string[]; title?: string; badges: RBlock[] }
  hover: RBlock[]
  actions: RBlock[]
}

/**
 * Which view a preset block shows on. Stored `slide` values: 0 = cover, -1 = actions, any other
 * number = hover (older presets had several custom slides — they all fold into hover).
 * No slide = by type: title → cover, the first image → cover (unless a cover image is set
 * explicitly), buttons → actions, everything else → hover.
 */
export function viewOf(f: FieldDef, fields: FieldDef[]): View {
  if (f.slide === 0) return COVER
  if (f.slide === ACTIONS_SLIDE) return ACTIONS
  if (f.slide !== undefined) return HOVER
  if (f.type === 'title') return COVER
  if (f.type === 'action') return ACTIONS
  if (f.type === 'image') {
    const explicitCover = fields.some((x) => x.slide === 0 && x.type === 'image')
    const firstAutoImage = fields.find((x) => x.slide === undefined && x.type === 'image')
    if (!explicitCover && firstAutoImage?.id === f.id) return COVER
  }
  return HOVER
}

/** View → stored slide value. */
export const slideFor = (v: View) => (v === COVER ? 0 : v === ACTIONS ? ACTIONS_SLIDE : 1)

/**
 * Caption of the i-th of n links in an action block, from the block label:
 *   "Полная | Демо"   → per link, in order
 *   "Скачать {text}"  → template; {text} = link text on the site, {n} = number
 *   "Скачать"         → as is for one link; for several, the site's link texts
 *   ""                → the site's link text
 */
export function linkCaption(label: string, text: string, i: number, n: number): string {
  const parts = label.split('|').map((s) => s.trim()).filter(Boolean)
  const fallback = text && text.length <= 40 ? text : `Ссылка ${i + 1}`
  let tpl: string
  if (parts.length > 1) tpl = parts[i] ?? fallback
  else if (parts.length === 1) tpl = n > 1 && !/\{(text|n)\}/.test(parts[0]) ? (text && text.length <= 40 ? text : `${parts[0]} ${i + 1}`) : parts[0]
  else tpl = fallback
  return tpl.replace(/\{text\}/g, text).replace(/\{n\}/g, String(i + 1)).replace(/\s+/g, ' ').trim() || fallback
}

/**
 * Builds the card from page defaults + preset blocks. Layout comes from the preset at render
 * time, so moving blocks between views in the constructor needs no re-parse.
 */
export function buildLayout(d: Extracted | undefined, preset: Preset | undefined): CardLayout {
  const fields = preset?.fields ?? []
  const fieldOf = new Map<string, FieldDef>(fields.map((f) => [f.id, f]))
  const order = new Map(fields.map((f, i) => [f.id, i]))
  const found = (d?.blocks ?? [])
    .filter((b) => fieldOf.has(b.fieldId))
    .sort((a, b) => order.get(a.fieldId)! - order.get(b.fieldId)!)
    .map((b) => {
      const f = fieldOf.get(b.fieldId)!
      return { f, block: { id: f.id, type: f.type, label: f.label, values: b.values, links: b.links } as RBlock }
    })

  const coverImages: string[] = []
  let title: string | undefined
  const coverBadges: RBlock[] = []
  const hover: RBlock[] = []
  const actions: RBlock[] = []
  for (const { f, block } of found) {
    const v = viewOf(f, fields)
    if (v === COVER) {
      if (f.type === 'image' || f.type === 'gallery') coverImages.push(...block.values)
      else if (f.type === 'title') title ??= block.values[0]
      else coverBadges.push(block)
    } else (v === HOVER ? hover : actions).push(block)
  }

  // page defaults (OpenGraph / JSON-LD) on the hover view, unless the preset supplies a description
  const ownDescription = found.some(({ f }) => f.type === 'description')
  const defDesc: RBlock[] = d?.description && !ownDescription ? [{ id: 'd-desc', type: 'description', label: '', values: [d.description] }] : []
  const defRest: RBlock[] = [
    ...(d?.badges.length ? [{ id: 'd-badges', type: 'badge', label: '', values: d.badges.map((b) => b.value) } as RBlock] : []),
    ...(d?.texts ?? []).map((t) => ({ id: `d-${t.label}`, type: 'text', label: t.label, values: [t.value] }) as RBlock),
  ]

  return {
    cover: { images: [...coverImages, ...(d?.images ?? (d?.image ? [d.image] : []))], title, badges: coverBadges },
    hover: [...defDesc, ...hover, ...defRest],
    actions,
  }
}
