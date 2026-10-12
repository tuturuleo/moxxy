import { useState, type DragEvent } from 'react'
import { DUPES } from '../../lib/dupes'
import type { Collection, Snapshot } from '../../lib/sources'
import { repoUrl } from '../../lib/updates'

export const GROUP_COLORS: Record<string, string> = {
  grey: '#9aa0a6', blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663', green: '#81c995',
  pink: '#ff8bcb', purple: '#c58af9', cyan: '#78d9ec', orange: '#fcad70',
}

const DRAG_TYPE = 'application/x-moxxy-item'

interface Props {
  snap: Snapshot
  current?: string
  /** pages open in more than one tab; the "Duplicates" row shows only when > 0 */
  dupeCount: number
  onSelect: (key: string) => void
  onDropItem: (itemKey: string, target: Collection) => void
}

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('moxxy.expanded') || '[]'))
  } catch {
    return new Set()
  }
}

export function Sidebar({ snap, current, dupeCount, onSelect, onDropItem }: Props) {
  const [expanded, setExpanded] = useState(loadExpanded)
  const [dropKey, setDropKey] = useState<string>()

  const toggle = (key: string) => {
    const next = new Set(expanded)
    next.has(key) ? next.delete(key) : next.add(key)
    setExpanded(next)
    try {
      localStorage.setItem('moxxy.expanded', JSON.stringify([...next]))
    } catch {}
  }

  const dropProps = (c: Collection) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = c.source === 'bookmark' ? 'copy' : 'move'
      setDropKey(c.key)
    },
    onDragLeave: () => setDropKey((k) => (k === c.key ? undefined : k)),
    onDrop: (e: DragEvent) => {
      setDropKey(undefined)
      const key = e.dataTransfer.getData(DRAG_TYPE)
      if (key) onDropItem(key, c)
    },
  })

  const row = (c: Collection, depth: number) => {
    const hasKids = c.children.length > 0
    const open = expanded.has(c.key) || depth === 0
    return (
      <div key={c.key}>
        <div
          className={`row ${current === c.key ? 'active' : ''} ${dropKey === c.key ? 'drop' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => onSelect(c.key)}
          {...dropProps(c)}
        >
          {c.source === 'tab' ? (
            <span className="gdot" style={{ background: GROUP_COLORS[c.color ?? 'grey'] }} />
          ) : hasKids && depth > 0 ? (
            <span
              className={`chev ${open ? 'open' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                toggle(c.key)
              }}
            >
              ›
            </span>
          ) : (
            <span className="chev" />
          )}
          <span className="name">{c.title || 'Без названия'}</span>
          <span className="cnt">{c.count || ''}</span>
        </div>
        {hasKids && open && c.children.map((k) => row(snap.collections.get(k)!, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="brand">Moxxy</div>
      <div className="section">
        <div className="section-title">Группы вкладок</div>
        {snap.groupKeys.length ? (
          snap.groupKeys.map((k) => row(snap.collections.get(k)!, 0))
        ) : (
          <div className="hint">Открытых групп нет. Сохранённые на панели группы видны, только когда они открыты.</div>
        )}
        {dupeCount > 0 && (
          <div className={`row ${current === DUPES ? 'active' : ''}`} style={{ paddingLeft: 10 }} onClick={() => onSelect(DUPES)} title="Страницы, открытые в нескольких вкладках">
            <span className="dupe-ico">⧉</span>
            <span className="name">Дубликаты</span>
            <span className="cnt">{dupeCount}</span>
          </div>
        )}
      </div>
      <div className="section">
        <div className="section-title">Закладки</div>
        {/* Chrome's system folders (Bookmarks bar / Other / Mobile) are hidden while empty */}
        {snap.bookmarkRoots.map((k) => snap.collections.get(k)!).filter((c) => c.count > 0 || c.children.length > 0 || c.key === current).map((c) => row(c, 0))}
      </div>
      <div className="side-foot">
        Moxxy {chrome.runtime.getManifest().version}
        {repoUrl() && (
          <>
            {' · '}
            <a href={repoUrl()} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </>
        )}
      </div>
    </aside>
  )
}
