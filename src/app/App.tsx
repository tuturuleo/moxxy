import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hostOf } from '../lib/bookmarks'
import { db } from '../lib/db'
import { DUPES, findDupes, times } from '../lib/dupes'
import { KINDS, resolveFit, resolveKind } from '../lib/kinds'
import { closeLeftoverParserTabs, isParsable, launchPicker, parseUrl } from '../lib/parser'
import { findPreset, matchPattern } from '../lib/presets'
import { ParseQueue, type Job } from '../lib/queue'
import { loadSettings, saveSettings, takePickerInbox, type Settings } from '../lib/settings'
import { addUrl, focusTab, loadSnapshot, moveItem, removeItem, reorderItem, saveGroupToBookmarks, subscribeSources, type Collection, type Item, type Snapshot } from '../lib/sources'
import { PARSE_VERSION, type CardData, type Kind, type Preset } from '../lib/types'
import { checkForUpdate, type UpdateInfo } from '../lib/updates'
import { Card, type CardAction } from './components/Card'
import { Lightbox } from './components/Lightbox'
import { SettingsModal, newPreset } from './components/SettingsModal'
import { GROUP_COLORS, Sidebar } from './components/Sidebar'

const DAY = 864e5
const DRAG_TYPE = 'application/x-moxxy-item'

interface Toast {
  text: string
  undo?: () => Promise<void>
}

function defaultCollection(snap: Snapshot): string | undefined {
  if (snap.groupKeys.length) return snap.groupKeys[0]
  let best: Collection | undefined
  for (const c of snap.collections.values()) if (c.source === 'bookmark' && c.count && (!best || c.count > best.count) && c.depth > 0) best = c
  return best?.key ?? snap.bookmarkRoots[0]
}

export function App() {
  const [snap, setSnap] = useState<Snapshot>()
  const [settings, setSettings] = useState<Settings>()
  const settingsRef = useRef<Settings>()
  const [cards, setCards] = useState<Map<string, CardData>>(new Map())
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const itemsRef = useRef<Item[]>([])
  itemsRef.current = snap?.items ?? []
  const [current, setCurrent] = useState<string>()
  const [query, setQuery] = useState('')
  const [progress, setProgress] = useState<[number, number]>([0, 0])
  const [modal, setModal] = useState<{ tab: 'presets' | 'general'; presetId?: string; testUrl?: string } | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  /** A newer GitHub release than the installed version (dot on ⚙). */
  const [newRelease, setNewRelease] = useState<UpdateInfo | null>(null)
  /** "Downloaded" marks per page url → when marked. Separate from card data so re-parsing keeps them. */
  const [marks, setMarks] = useState<Record<string, number>>({})
  useEffect(() => {
    chrome.storage.local.get('marks').then((r) => setMarks(r.marks ?? {}))
  }, [])
  const toggleMark = useCallback((url: string) => {
    setMarks((prev) => {
      const next = { ...prev }
      if (next[url]) delete next[url]
      else next[url] = Date.now()
      chrome.storage.local.set({ marks: next })
      return next
    })
  }, [])
  const visibleRef = useRef(new Set<string>())

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current!, ...patch }
    settingsRef.current = next
    setSettings(next)
    saveSettings(next)
  }, [])

  const showToast = useCallback((t: Toast) => setToast(t), [])

  /** Insertion bar for drag-reorder, toggled straight on the DOM (no re-render per dragover). */
  const dropMark = useRef<{ el: HTMLElement; after: boolean } | null>(null)
  const showDropMark = useCallback((el: HTMLElement | null, after = false) => {
    const cur = dropMark.current
    if (cur && (cur.el !== el || cur.after !== after)) cur.el.classList.remove('drop-before', 'drop-after')
    dropMark.current = el ? { el, after } : null
    el?.classList.add(after ? 'drop-after' : 'drop-before')
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [toast])

  // ---- parse queue
  const queue = useMemo(
    () =>
      new ParseQueue(
        async (job) => {
          let card: CardData
          try {
            card = { id: job.url, ...(await parseUrl(job.url, settingsRef.current?.presets ?? [], { forceTab: job.forceTab, interactive: job.urgent, liveTabId: job.liveTabId })) }
          } catch (e) {
            const prev = cardsRef.current.get(job.url)
            card = {
              id: job.url,
              url: job.url,
              status: 'error',
              error: e instanceof Error ? e.message : String(e),
              parsedAt: Date.now(),
              data: prev?.data,
              v: PARSE_VERSION,
              presetId: findPreset(job.url, settingsRef.current?.presets ?? [])?.id,
            }
          }
          await db.putCard(card)
          setCards((prev) => new Map(prev).set(card.id, card))
          // Bookmarks added from Moxxy start with the URL as their title.
          const t = card.data?.title
          if (t) for (const it of itemsRef.current) if (it.source === 'bookmark' && it.url === job.url && it.title === it.url) chrome.bookmarks.update(it.bookmarkId!, { title: t })
        },
        (d, t) => setProgress([d, t]),
      ),
    [],
  )
  useEffect(() => {
    queue.priority = (j) => (visibleRef.current.has(j.url) ? 0 : 1)
  }, [queue])

  const jobFor = (it: Item, extra: Partial<Job> = {}): Job => ({ id: it.url, url: it.url, liveTabId: it.loaded ? it.tabId : undefined, ...extra })

  // ---- load + live sync with Chrome
  const reload = useCallback(async () => setSnap(await loadSnapshot()), [])
  useEffect(() => {
    ;(async () => {
      const [s, all, inbox] = await Promise.all([loadSettings(), db.allCards(), takePickerInbox()])
      if (inbox.length) {
        const byId = new Map(s.presets.map((x) => [x.id, x]))
        inbox.forEach((x) => byId.set(x.id, x))
        s.presets = [...byId.values()]
        saveSettings(s)
      }
      settingsRef.current = s
      setSettings(s)
      const map = new Map(all.map((c) => [c.id, c]))
      cardsRef.current = map
      setCards(map)
      closeLeftoverParserTabs().catch(() => {})
      checkForUpdate().then((u) => u?.newer && setNewRelease(u), () => {}) // cached: hits GitHub at most once a day
      await reload()
    })()
    return subscribeSources(reload)
  }, [reload])

  // pick a collection once data is in
  useEffect(() => {
    if (!snap || !settings) return
    if (current && snap.collections.has(current)) return
    if (!current && settings.lastCollection && snap.collections.has(settings.lastCollection)) setCurrent(settings.lastCollection)
    else if (!current) setCurrent(defaultCollection(snap))
  }, [snap, settings, current])

  // enqueue everything new / stale; drop long-orphaned cache entries
  const ready = !!settings
  useEffect(() => {
    if (!snap || !ready) return
    const now = Date.now()
    const stale = settingsRef.current!.staleDays * DAY
    const jobs = new Map<string, Job>()
    const presets = settingsRef.current!.presets
    for (const it of snap.items) {
      if (!isParsable(it.url)) continue
      const c = cardsRef.current.get(it.url)
      const due =
        !c ||
        (c.v ?? 1) < PARSE_VERSION ||
        // a preset for this site appeared / was removed (import, picker inbox, toggled)
        (c.status !== 'skip' && (findPreset(it.url, presets)?.id ?? undefined) !== c.presetId) ||
        now - c.parsedAt > (c.status === 'error' ? DAY : stale) ||
        // was parsed from outside while the tab slept; now it's loaded, read it live
        (it.loaded && c.via !== 'tab' && (c.status === 'weak' || c.status === 'error'))
      if (!due || queue.isQueued(it.url)) continue
      if (!jobs.has(it.url) || it.loaded) jobs.set(it.url, jobFor(it))
    }
    queue.add([...jobs.values()])

    const urls = new Set(snap.items.map((i) => i.url))
    const orphans = [...cardsRef.current.values()].filter((c) => !urls.has(c.id) && now - c.parsedAt > 7 * DAY).map((c) => c.id)
    if (orphans.length) {
      db.deleteCards(orphans)
      setCards((prev) => {
        const n = new Map(prev)
        orphans.forEach((id) => n.delete(id))
        return n
      })
    }
  }, [snap, ready, queue, settings?.presets])

  // ---- picker → preset
  const savePreset = useCallback(
    (p: Preset, reparse = true) => {
      const list = settingsRef.current!.presets
      update({ presets: list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p] })
      if (!reparse) return
      const seen = new Set<string>()
      const jobs = itemsRef.current.filter((it) => isParsable(it.url) && matchPattern(p.match, it.url) && !seen.has(it.url) && seen.add(it.url)).map((it) => jobFor(it))
      queue.add(jobs)
    },
    [update, queue],
  )
  const deletePreset = useCallback((id: string) => update({ presets: settingsRef.current!.presets.filter((x) => x.id !== id) }), [update])

  useEffect(() => {
    const onMsg = (msg: any, sender: chrome.runtime.MessageSender, respond: (r: unknown) => void) => {
      if (msg?.type !== 'moxxy:picker-save') return
      savePreset(msg.preset as Preset)
      respond({ ok: true })
      if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id).catch(() => {})
      chrome.tabs.getCurrent((t) => t?.id != null && chrome.tabs.update(t.id, { active: true }))
      setToast({ text: `Пресет «${msg.preset.name}» сохранён, обновляю карточки` })
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [savePreset])

  // ---- what's on screen
  const col = current ? snap?.collections.get(current) : undefined
  const dupes = useMemo(() => findDupes(snap?.items ?? []), [snap])
  const inDupes = !query.trim() && current === DUPES
  /** Everything in the current collection / search, sorted — before the downloaded filter. */
  const unfiltered = useMemo(() => {
    if (!snap || !settings) return []
    const q = query.trim().toLowerCase()
    let list: Item[]
    if (q) {
      list = snap.items.filter((it) => {
        const d = cards.get(it.url)?.data
        return `${it.title} ${it.url} ${d?.title ?? ''} ${d?.description ?? ''}`.toLowerCase().includes(q)
      })
    } else if (!current) list = []
    else if (current === DUPES) list = dupes.groups.flatMap((g) => g.items)
    else list = snap.items.filter((it) => (settings.includeNested ? it.ancestors.includes(current) : it.container === current))
    const titleOf = (it: Item) => (settings.titleSource === 'page' ? cards.get(it.url)?.data?.title || it.title : it.title || cards.get(it.url)?.data?.title || it.url)
    if (current !== DUPES || q) {
      if (settings.sort === 'new') list = [...list].sort((a, b) => b.dateAdded - a.dateAdded)
      else if (settings.sort === 'old') list = [...list].sort((a, b) => a.dateAdded - b.dateAdded)
      else if (settings.sort === 'title') list = [...list].sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'ru'))
      // downloaded first, otherwise Chrome's order (sort is stable)
      else if (settings.sort === 'downloaded') list = [...list].sort((a, b) => +!!marks[b.url] - +!!marks[a.url])
    }
    return list.slice(0, 3000).map((it) => ({ it, title: titleOf(it) }))
  }, [snap, settings, query, current, cards, dupes, marks])

  const doneCount = unfiltered.filter(({ it }) => marks[it.url]).length
  // the filter is offered only where something is marked; otherwise it's ignored
  const markFilter = doneCount > 0 && !inDupes ? settings?.markFilter ?? 'all' : 'all'
  const visible = useMemo(
    () => (markFilter === 'all' ? unfiltered : unfiltered.filter(({ it }) => !!marks[it.url] === (markFilter === 'done'))),
    [unfiltered, markFilter, marks],
  )

  /** "×2 · also open in: A, P1" for a duplicated tab. */
  const dupeInfo = useCallback(
    (it: Item) => {
      const g = dupes.byItem.get(it.key)
      if (!g) return undefined
      const others = g.items.filter((x) => x.key !== it.key).map((x) => snap?.collections.get(x.container)?.title ?? '?')
      return { count: g.items.length, where: [...new Set(others)].join(', ') }
    },
    [dupes, snap],
  )

  /** Close every other copy of this page; one "Undo" brings them all back. */
  const keepOnly = useCallback(
    async (it: Item) => {
      const g = dupes.byItem.get(it.key)
      if (!g) return
      const undos: (() => Promise<void>)[] = []
      for (const other of g.items) if (other.key !== it.key) undos.push(await removeItem(other))
      showToast({
        text: `Закрыто копий: ${undos.length}`,
        undo: async () => {
          for (const u of undos) await u()
        },
      })
    },
    [dupes, showToast],
  )

  useEffect(() => {
    visibleRef.current = new Set(visible.map((v) => v.it.url))
  }, [visible])

  const aspectFor = useCallback(
    (key: string) => KINDS[resolveKind(key, snap?.collections ?? new Map(), settings?.folderKinds ?? {})].aspect,
    [snap, settings?.folderKinds],
  )
  const fitFor = useCallback(
    (key: string | undefined) => resolveFit(key, snap?.collections ?? new Map(), settings?.folderFits ?? {}, settings?.imageFit ?? 'cover'),
    [snap, settings?.folderFits, settings?.imageFit],
  )

  // ---- card actions
  const onAction = useCallback(
    async (it: Item, a: CardAction, arg?: { images: string[]; index: number }) => {
      switch (a) {
        case 'open':
          return focusTab(it)
        case 'refresh':
          return queue.add([jobFor(it, { urgent: true })])
        case 'refreshTab':
          return queue.add([jobFor(it, { urgent: true, forceTab: true })])
        case 'picker':
          return launchPicker(it.url, findPreset(it.url, settingsRef.current!.presets) ?? newPreset(it.url))
        case 'editor': {
          let p = findPreset(it.url, settingsRef.current!.presets)
          if (!p) savePreset((p = newPreset(it.url)), false)
          return setModal({ tab: 'presets', presetId: p.id, testUrl: it.url })
        }
        case 'downloaded':
          return toggleMark(it.url)
        case 'gallery':
          if (arg?.images.length) setLightbox(arg)
          return
        case 'delete': {
          const undo = await removeItem(it)
          showToast({ text: it.source === 'tab' ? `Вкладка «${it.title}» закрыта` : `Закладка «${it.title}» удалена`, undo })
        }
      }
    },
    [queue, showToast, savePreset, toggleMark],
  )

  const onDropItem = useCallback(
    async (key: string, target: Collection) => {
      const it = itemsRef.current.find((x) => x.key === key)
      if (!it || it.container === target.key) return
      try {
        await moveItem(it, target)
        if (it.source === 'tab' && target.source === 'bookmark') showToast({ text: `Сохранено в закладки: «${target.title}»` })
      } catch (e) {
        showToast({ text: `Не получилось: ${e instanceof Error ? e.message : e}` })
      }
    },
    [showToast],
  )

  const addPrompt = async () => {
    if (!col) return
    const url = prompt(col.source === 'tab' ? `Открыть ссылку в группе «${col.title}»:` : `Добавить закладку в «${col.title}»:`)?.trim()
    if (url) await addUrl(/^\w+:/.test(url) ? url : 'https://' + url, col)
  }

  if (!snap || !settings) return <div className="boot" />

  const kindKey = current
  const explicitKind = kindKey ? settings.folderKinds[kindKey] : undefined
  const effKind = resolveKind(current, snap.collections, settings.folderKinds)
  const weakBookmarks = visible.filter(({ it }) => it.source === 'bookmark' && ['weak', 'error'].includes(cards.get(it.url)?.status ?? ''))
  const subCols = !query && col?.children.length ? col.children.map((k) => snap.collections.get(k)!) : []
  const titleOf = (it: Item) => visible.find((v) => v.it.key === it.key)?.title ?? it.title
  // Drag to reorder only where the screen shows Chrome's own order.
  const canReorder = !query.trim() && !inDupes && !!col && (settings.sort === 'chrome' || (settings.sort === 'downloaded' && !doneCount))
  const renderCard = (it: Item, title: string) => (
    <Card
      key={it.key}
      item={it}
      card={cards.get(it.url)}
      title={title}
      aspect={aspectFor(it.container)}
      fit={fitFor(it.container)}
      queued={queue.isQueued(it.url)}
      preset={findPreset(it.url, settings.presets)}
      downloaded={!!marks[it.url]}
      dupeCount={dupeInfo(it)?.count}
      dupeWhere={dupeInfo(it)?.where}
      onAction={onAction}
    />
  )

  return (
    <div className="app" style={{ ['--card-w' as string]: `${settings.cardSize}px` }}>
      <Sidebar
        snap={snap}
        current={query ? undefined : current}
        dupeCount={dupes.groups.length}
        onSelect={(k) => {
          setQuery('')
          setCurrent(k)
          if (k !== DUPES) update({ lastCollection: k })
          document.querySelector('.content')?.scrollTo(0, 0)
        }}
        onDropItem={onDropItem}
      />
      <main
        className="content"
        onScroll={(e) => {
          // fade under the sticky header only once something can be under it
          e.currentTarget.classList.toggle('scrolled', e.currentTarget.scrollTop > 0)
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE) && e.dataTransfer.types.includes('text/uri-list')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE) || !col) return
          const url = e.dataTransfer.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#'))
          if (url) (e.preventDefault(), addUrl(url.trim(), col))
        }}
      >
        {progress[1] > 0 && (
          <div className="progress" title={`Загрузка карточек: ${progress[0]} / ${progress[1]}`}>
            <div style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
          </div>
        )}
        <header className="top">
          <div className="heading">
            <h1>{query ? 'Поиск' : inDupes ? 'Дубликаты' : col?.title || '—'}</h1>
            <span className="count" title={inDupes ? 'страниц, открытых больше одного раза' : undefined}>
              {inDupes ? dupes.groups.length : visible.length}
            </span>
            {progress[1] > 0 && (
              <span className="parsing">
                загружаю {progress[0]}/{progress[1]}
              </span>
            )}
          </div>
          <div className="toolbar">
            <input className="search" type="search" placeholder="Поиск везде…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {!query && col && (
              <select
                title="Формат карточек в этой коллекции (ничего не перемещает)"
                value={explicitKind ?? ''}
                onChange={(e) => {
                  const fk = { ...settings.folderKinds }
                  if (e.target.value) fk[col.key] = e.target.value as Kind
                  else delete fk[col.key]
                  update({ folderKinds: fk })
                }}
              >
                <option value="">Формат: авто ({KINDS[effKind].label.toLowerCase()})</option>
                {(Object.keys(KINDS) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {KINDS[k].label}
                  </option>
                ))}
              </select>
            )}
            {!query && col && (
              <select
                value={fitFor(col.key)}
                onChange={(e) => update({ folderFits: { ...settings.folderFits, [col.key]: e.target.value as Settings['imageFit'] } })}
                title="Как помещать картинку в карточку — для этой группы / папки"
              >
                <option value="cover">Картинка: заполнить</option>
                <option value="contain">Картинка: целиком</option>
              </select>
            )}
            <select value={settings.sort === 'downloaded' && !doneCount ? 'chrome' : settings.sort} onChange={(e) => update({ sort: e.target.value as Settings['sort'] })} title="Сортировка">
              <option value="chrome">Как в Chrome</option>
              <option value="new">Сначала новые</option>
              <option value="old">Сначала старые</option>
              <option value="title">По названию</option>
              {doneCount > 0 && <option value="downloaded">Сначала скачанные</option>}
            </select>
            <input
              className="size"
              type="range"
              min={150}
              max={420}
              step={10}
              value={settings.cardSize}
              title="Размер карточек"
              onChange={(e) => update({ cardSize: +e.target.value })}
            />
            {col?.source === 'tab' && !query && (
              <button
                title="Скопировать вкладки группы в папку закладок с тем же названием (повторно — досинхронизировать)"
                onClick={async () => {
                  const n = await saveGroupToBookmarks(col, snap.items.filter((i) => i.container === col.key))
                  showToast({ text: n ? `В закладки «${col.title}» добавлено: ${n}` : 'В закладках уже всё есть' })
                }}
              >
                В закладки
              </button>
            )}
            {col && !query && (
              <button onClick={addPrompt} title={col.source === 'tab' ? 'Открыть ссылку в этой группе' : 'Добавить закладку'}>
                +
              </button>
            )}
            {visible.length > 0 && (
              <button
                title={query ? 'Перезагрузить карточки из результатов поиска' : 'Перезагрузить карточки только этой группы / папки'}
                onClick={() => {
                  const seen = new Set<string>()
                  const jobs = visible.filter(({ it }) => isParsable(it.url) && !seen.has(it.url) && seen.add(it.url)).map(({ it }) => jobFor(it))
                  queue.add(jobs)
                  showToast({ text: `Обновляю карточки: ${jobs.length}` })
                }}
              >
                ↻
              </button>
            )}
            <button onClick={() => setModal({ tab: 'presets' })} title="Конструктор карточек для сайтов">
              ✎ Конструктор
            </button>
            <button onClick={() => setModal({ tab: 'general' })} title={newRelease ? `Настройки · доступна версия ${newRelease.latest}` : 'Настройки'} className={newRelease ? 'has-update' : undefined}>
              ⚙
            </button>
          </div>
        </header>

        {(subCols.length > 0 || weakBookmarks.length > 0 || (doneCount > 0 && !inDupes)) && (
          <div className="subbar">
            {doneCount > 0 && !inDupes && (
              <div className="seg" role="group" aria-label="Фильтр по отметке «Скачано»">
                {(
                  [
                    ['all', 'Все', unfiltered.length],
                    ['done', '✓ Скачанные', doneCount],
                    ['todo', 'Не скачанные', unfiltered.length - doneCount],
                  ] as const
                ).map(([k, label, n]) => (
                  <button key={k} className={markFilter === k ? 'on' : ''} onClick={() => update({ markFilter: k })}>
                    {label} <small>{n}</small>
                  </button>
                ))}
              </div>
            )}
            {subCols.map((c) => (
              <button key={c.key} className="chip-btn" onClick={() => setCurrent(c.key)}>
                {c.title} <small>{c.count}</small>
              </button>
            ))}
            {subCols.length > 0 && (
              <label className="nested">
                <input type="checkbox" checked={settings.includeNested} onChange={(e) => update({ includeNested: e.target.checked })} /> со вложенными
              </label>
            )}
            {weakBookmarks.length > 0 && (
              <button
                className="chip-btn warn"
                title="Сайты, которые не отдали данные обычным запросом, загрузить через фоновую вкладку (по одной)"
                onClick={() => queue.add(weakBookmarks.map(({ it }) => jobFor(it, { forceTab: true })))}
              >
                Догрузить пустые через вкладку · {weakBookmarks.length}
              </button>
            )}
          </div>
        )}

        {inDupes ? (
          dupes.groups.length ? (
            <div className="dupes">
              {dupes.groups.map((g) => (
                <section key={g.key} className="dupe-group">
                  <div className="dupe-head">
                    <b>{titleOf(g.items[0])}</b>
                    <small>
                      открыта {times(g.items.length)} · {hostOf(g.items[0].url)}
                    </small>
                  </div>
                  <div className="grid">
                    {g.items.map((it) => (
                      <div key={it.key} className="dupe-cell">
                        {renderCard(it, titleOf(it))}
                        <div className="dupe-foot">
                          <span title="Группа вкладок">
                            <i className="gdot" style={{ background: GROUP_COLORS[snap.collections.get(it.container)?.color ?? 'grey'] }} />
                            {snap.collections.get(it.container)?.title}
                          </span>
                          <button onClick={() => keepOnly(it)} title="Закрыть остальные копии этой страницы">
                            Оставить эту
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="empty">Дубликатов нет — каждая страница открыта по одному разу</div>
          )
        ) : visible.length ? (
          <div
            className="grid"
            onDragOver={(e) => {
              if (!canReorder || !e.dataTransfer.types.includes(DRAG_TYPE)) return
              const el = (e.target as Element).closest<HTMLElement>('.card[data-key]')
              if (!el) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const r = el.getBoundingClientRect()
              showDropMark(el, e.clientX > r.left + r.width / 2)
            }}
            onDragLeave={(e) => {
              if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) showDropMark(null)
            }}
            onDrop={async (e) => {
              const mark = dropMark.current
              showDropMark(null)
              if (!canReorder || !mark) return
              e.preventDefault()
              const key = e.dataTransfer.getData(DRAG_TYPE)
              const it = snap.items.find((x) => x.key === key)
              const target = snap.items.find((x) => x.key === mark.el.dataset.key)
              if (!it || !target) return
              try {
                await reorderItem(it, target, mark.after)
              } catch (err) {
                showToast({ text: `Не получилось переставить: ${err instanceof Error ? err.message : err}` })
              }
            }}
            onDragEnd={() => showDropMark(null)}
          >
            {visible.map(({ it, title }) => renderCard(it, title))}
          </div>
        ) : (
          <div className="empty">{query ? 'Ничего не найдено' : col?.source === 'tab' ? 'В этой группе нет вкладок' : 'Здесь пусто'}</div>
        )}
      </main>

      {modal && (
        <SettingsModal
          tab={modal.tab}
          presetId={modal.presetId}
          testUrl={modal.testUrl}
          settings={settings}
          update={update}
          savePreset={savePreset}
          createPreset={() => {
            const p = newPreset()
            savePreset(p, false)
            return p
          }}
          deletePreset={deletePreset}
          sampleUrl={(m) => snap.items.find((i) => matchPattern(m, i.url))?.url}
          openPicker={(url, p) => launchPicker(url, p)}
          reparseAll={() => {
            const seen = new Set<string>()
            queue.add(snap.items.filter((i) => isParsable(i.url) && !seen.has(i.url) && seen.add(i.url)).map((i) => jobFor(i)))
          }}
          onClose={() => setModal(null)}
        />
      )}
      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={async () => {
                const u = toast.undo!
                setToast(null)
                await u()
              }}
            >
              Отменить
            </button>
          )}
        </div>
      )}
    </div>
  )
}
