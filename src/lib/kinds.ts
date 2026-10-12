import type { Collection } from './sources'
import type { Kind } from './types'

// A "kind" only changes how cards look (poster vs landscape). It never moves anything.
export const KINDS: Record<Kind, { label: string; aspect: string }> = {
  watch: { label: 'Постеры (смотреть)', aspect: '2 / 3' },
  read: { label: 'Обложки (читать)', aspect: '2 / 3' },
  play: { label: 'Широкие (игры)', aspect: '4 / 3' },
  default: { label: 'Обычные', aspect: '4 / 3' },
}

export function guessKind(title: string): Kind {
  const t = title.toLowerCase()
  if (/смотр|фильм|сериал|аниме|кино|видео|watch|movie|anime|video/.test(t)) return 'watch'
  if (/игр|поигр|play|game/.test(t)) return 'play'
  if (/чита|почит|книг|манг|ранобэ|read|book|manga/.test(t)) return 'read'
  return 'default'
}

/** Image fit of a collection: its own choice, else the nearest parent's, else the global default. */
export function resolveFit<T extends string>(key: string | undefined, collections: Map<string, Collection>, explicit: Record<string, T>, fallback: T): T {
  for (let cur = key; cur; cur = collections.get(cur)?.parentKey) if (explicit[cur]) return explicit[cur]
  return fallback
}

/** Nearest collection up the chain with an explicit or name-guessed non-default kind. */
export function resolveKind(key: string | undefined, collections: Map<string, Collection>, explicit: Record<string, Kind>): Kind {
  for (let cur = key; cur; cur = collections.get(cur)?.parentKey) {
    if (explicit[cur]) return explicit[cur]
    const k = guessKind(collections.get(cur)?.title ?? '')
    if (k !== 'default') return k
  }
  return 'default'
}
