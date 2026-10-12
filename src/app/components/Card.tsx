import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { faviconUrl, hostOf } from '../../lib/bookmarks'
import { cachedImage } from '../../lib/imagecache'
import { times } from '../../lib/dupes'
import { useSeen } from '../../lib/inview'
import { ACTIONS, COVER, HOVER, buildLayout, linkCaption, type RBlock, type View } from '../../lib/layout'
import type { Settings } from '../../lib/settings'
import type { Item } from '../../lib/sources'
import type { CardData, Preset } from '../../lib/types'

export type CardAction = 'open' | 'refresh' | 'refreshTab' | 'picker' | 'editor' | 'delete' | 'gallery' | 'downloaded'

const HOVER_DELAY_MS = 120

interface Props {
  item: Item
  card?: CardData
  title: string
  aspect: string
  fit: Settings['imageFit']
  queued: boolean
  /** Preset matching this URL: decides which blocks go to which view. */
  preset?: Preset
  /** Pin a view (constructor preview). */
  forceView?: View
  /** Marked as downloaded by the user. */
  downloaded?: boolean
  /** The same page is open in this many tabs (≥ 2), and where the other copies are. */
  dupeCount?: number
  dupeWhere?: string
  onAction: (item: Item, action: CardAction, arg?: { images: string[]; index: number }) => void
}

const plainClick = (e: MouseEvent) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey

/**
 * Three views stacked on top of each other: cover (default), hover (shown while the cursor is on
 * the card) and actions (right click or the "⋯" button). Hover/actions are translucent overlays
 * over the cover, so switching is a quick crossfade.
 */
export const Card = memo(function Card({ item, card, title, aspect, fit, queued, preset, forceView, downloaded, dupeCount, dupeWhere, onAction }: Props) {
  const d = card?.data
  const layout = useMemo(() => buildLayout(d, preset), [d, preset])
  const [view, setView] = useState<View>(COVER)
  const shown = forceView ?? view
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  const open = (e: MouseEvent) => {
    if (item.source === 'tab' && plainClick(e)) {
      e.preventDefault()
      onAction(item, 'open')
    }
  }
  /** Click on the hover overlay itself (not on its buttons/links) opens the page like the cover. */
  const openFromOverlay = (e: MouseEvent) => {
    if ((e.target as Element).closest('a, button')) return
    if (item.source === 'tab' && plainClick(e)) return onAction(item, 'open')
    if (e.button === 0 || e.button === 1) window.open(item.url, '_blank', 'noopener')
  }
  const onGallery = (images: string[], index: number) => onAction(item, 'gallery', { images, index })
  const host = hostOf(item.url)
  const coverTitle = layout.cover.title || title
  const coverBadges = layout.cover.badges.length
    ? layout.cover.badges.flatMap((b) => b.values.map((v) => ({ label: b.label, value: v }))).slice(0, 3)
    : [d?.badges.find((b) => b.label === 'Рейтинг') ?? d?.badges[0]].filter((b) => !!b)
  const status = card?.status ?? (queued ? 'pending' : 'none')
  // the "downloaded" toggle makes sense where the preset found download links (or it's already marked)
  const hasDownloads = [...layout.hover, ...layout.actions].some((b) => b.type === 'action' && b.links?.length)

  return (
    <div
      className={`card st-${status} view-${shown}`}
      data-key={item.key}
      style={{ aspectRatio: aspect }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-moxxy-item', item.key)
        e.dataTransfer.setData('text/uri-list', item.url)
        e.dataTransfer.effectAllowed = 'copyMove'
      }}
      onMouseEnter={() => {
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setView((v) => (v === COVER ? HOVER : v)), HOVER_DELAY_MS)
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current)
        setView(COVER)
      }}
      onContextMenu={(e) => {
        // right click toggles the actions view; Shift + right click keeps the browser menu
        if (e.shiftKey) return
        e.preventDefault()
        clearTimeout(timer.current)
        setView((v) => (v === ACTIONS ? HOVER : ACTIONS))
      }}
    >
      <a className="cover" href={item.url} target="_blank" rel="noreferrer" draggable={false} onClick={open}>
        <CardImage sources={layout.cover.images} url={item.url} fit={fit} />
        <div className="shade" />
        {coverBadges.length > 0 && (
          <div className="cover-badges">
            {coverBadges.map((b, i) => (
              <span className="cover-badge" key={i} title={b!.label}>
                {b!.value}
              </span>
            ))}
          </div>
        )}
        <div className="corner">
          {!!dupeCount && (
            <span className="dupe-badge" title={`Открыта ${times(dupeCount)}${dupeWhere ? ` · ещё в: ${dupeWhere}` : ''}`}>
              ×{dupeCount}
            </span>
          )}
          {downloaded && (
            <span className="mark-badge" title="Скачано">
              ✓
            </span>
          )}
          {status === 'pending' && <span className="loading" title="Загружается…" />}
        </div>
        <div className="cover-title">
          <img className="fav" src={faviconUrl(item.url)} alt="" />
          <span>{coverTitle}</span>
        </div>
      </a>

      <div className="overlay hover" aria-hidden={shown !== HOVER} onClick={openFromOverlay} onAuxClick={openFromOverlay}>
        <div className="blocks">
          {!layout.hover.some((b) => b.type === 'title') && <div className="info-title">{d?.title || title}</div>}
          {layout.hover.map((b) => (
            <BlockView key={b.id} b={b} onGallery={onGallery} />
          ))}
        </div>
        <button className="more-btn" title="Действия (или правый клик по карточке)" onClick={() => setView(ACTIONS)}>
          ⋯
        </button>
      </div>

      <div className="overlay actions" aria-hidden={shown !== ACTIONS}>
        <a className="btn primary" href={item.url} target="_blank" rel="noreferrer" draggable={false} onClick={open}>
          {item.source === 'tab' ? 'Перейти к вкладке' : 'Открыть'}
        </a>
        <div className="action-list">
          {layout.actions.map((b) => (
            <BlockView key={b.id} b={b} onGallery={onGallery} />
          ))}
        </div>
        {(hasDownloads || downloaded) && (
          <button className={`btn mark ${downloaded ? 'on' : ''}`} onClick={() => onAction(item, 'downloaded')} title={downloaded ? 'Снять отметку' : 'Поставить галочку на обложке'}>
            {downloaded ? '✓ Скачано' : 'Отметить скачанным'}
          </button>
        )}
        <div className="tools">
          <button title="Назад к описанию" onClick={() => setView(HOVER)}>‹</button>
          <button title="Обновить данные" onClick={() => onAction(item, 'refresh')}>↻</button>
          {item.source === 'bookmark' && (
            <button title="Загрузить через вкладку (для сайтов на JS или с авторизацией)" onClick={() => onAction(item, 'refreshTab')}>⧉</button>
          )}
          <button title="Выбрать элементы на странице мышкой" onClick={() => onAction(item, 'picker')}>⌖</button>
          <button title={preset ? 'Конструктор карточки этого сайта' : 'Создать конструктор карточки для этого сайта'} onClick={() => onAction(item, 'editor')}>✎</button>
          <button className="danger" title={item.source === 'tab' ? 'Закрыть вкладку' : 'Удалить закладку'} onClick={() => onAction(item, 'delete')}>✕</button>
        </div>
        <div className="meta" title={card?.error}>
          {host}
          {card?.status === 'error' && ' · ошибка'}
          {card?.status === 'weak' && ' · мало данных'}
          {preset && ` · ${preset.name}`}
        </div>
      </div>
    </div>
  )
})

type GalleryFn = (images: string[], index: number) => void

const DEFAULT_LABELS = new Set(['', 'Описание', 'Текст', 'Бейдж', 'Заголовок'])

function BlockView({ b, onGallery }: { b: RBlock; onGallery: GalleryFn }) {
  const caption = !DEFAULT_LABELS.has(b.label) && <div className="b-label">{b.label}</div>
  switch (b.type) {
    case 'title':
      return <div className="info-title">{b.values[0]}</div>
    case 'description':
      return (
        <div className="b-text grow">
          {caption}
          <p className="desc">{b.values.join('\n\n')}</p>
        </div>
      )
    case 'text': {
      const v = b.values.join('\n')
      if (v.length <= 60 && !v.includes('\n'))
        return (
          <div className="kv">
            {b.label && !DEFAULT_LABELS.has(b.label) && <span>{b.label}</span>}
            {v}
          </div>
        )
      return (
        <div className="b-text">
          {caption}
          <p className="desc small">{v}</p>
        </div>
      )
    }
    case 'badge':
      return (
        <div className="chips">
          {b.values.map((v, i) => (
            <span className="chip" key={i} title={b.label}>
              {v}
            </span>
          ))}
        </div>
      )
    case 'action':
      return (
        <div className="b-actions">
          {(b.links ?? []).map((a, i, all) => (
            <a key={i} className="btn accent" href={a.value} target="_blank" rel="noreferrer" draggable={false} title={a.value}>
              {linkCaption(b.label, a.label, i, all.length)}
            </a>
          ))}
        </div>
      )
    case 'image':
    case 'gallery':
      return <Media b={b} onGallery={onGallery} />
  }
}

function Media({ b, full, onGallery }: { b: RBlock; full?: boolean; onGallery: GalleryFn }) {
  const imgs = b.values
  // a single picture inside the hover view stays a thumbnail like gallery items; only a stand-alone slide shows it full
  if (imgs.length === 1 && full)
    return (
      <button className={`media-one ${full ? 'full' : ''}`} onClick={() => onGallery(imgs, 0)}>
        <img src={imgs[0]} loading="lazy" referrerPolicy="no-referrer" alt="" />
      </button>
    )
  const shown = imgs.slice(0, full ? 6 : 4)
  return (
    <div className={`gallery ${full ? 'full' : ''}`}>
      {shown.map((src, i) => (
        <button key={src} onClick={() => onGallery(imgs, i)}>
          <img src={src} loading="lazy" referrerPolicy="no-referrer" alt="" />
          {i === shown.length - 1 && imgs.length > shown.length && <span className="more">+{imgs.length - shown.length}</span>}
        </button>
      ))}
    </div>
  )
}

/** Tries the cover candidates in order until one actually loads. */
function CardImage({ sources, url, fit }: { sources: string[]; url: string; fit: Settings['imageFit'] }) {
  const [i, setI] = useState(0)
  const key = sources.join('\n')
  useEffect(() => setI(0), [key])
  const src = sources[i]
  if (!src) return <Placeholder url={url} />
  return <SingleImage key={src} src={src} fit={fit} onFail={() => setI((v) => v + 1)} />
}

/**
 * Cover from the local cache (downloaded once, downscaled, with its dominant color).
 * If the extension can't cache it, falls back to a plain <img>; if that fails too — next candidate.
 */
function SingleImage({ src, fit, onFail }: { src: string; fit: Settings['imageFit']; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const seen = useSeen(box) // only fetch covers of cards that are on (or near) the screen
  const [img, setImg] = useState<{ url?: string; color?: string; direct?: boolean }>({})
  useEffect(() => {
    if (!seen) return
    let alive = true
    cachedImage(src).then((c) => alive && setImg(c ? { url: c.url, color: c.color } : { direct: true }))
    return () => void (alive = false)
  }, [seen, src])

  const shown = img.url ?? (img.direct ? src : undefined)
  return (
    <div ref={box} className="img-box">
      {shown && (
        <img
          className={`cover-img ${fit === 'contain' ? 'contain' : ''}`}
          style={fit === 'contain' && img.color ? { backgroundColor: img.color } : undefined}
          src={shown}
          decoding="async"
          referrerPolicy="no-referrer"
          alt=""
          onLoad={(e) => {
            // tracking pixels / "no image" stubs
            const im = e.currentTarget
            if (im.naturalWidth < 40 || im.naturalHeight < 40) onFail()
          }}
          onError={() => (img.url ? setImg({ direct: true }) : onFail())}
        />
      )}
    </div>
  )
}

function Placeholder({ url }: { url: string }) {
  const host = hostOf(url)
  let h = 0
  for (const ch of host) h = (h * 31 + ch.charCodeAt(0)) % 360
  return (
    <div className="placeholder" style={{ background: `linear-gradient(135deg, hsl(${h} 35% 22%), hsl(${(h + 40) % 360} 30% 12%))` }}>
      <img src={faviconUrl(url, 64)} alt="" />
      <span>{host}</span>
    </div>
  )
}
