import { useEffect, useMemo, useRef, useState } from 'react'
import { ACTIONS, COVER, HOVER, VIEW_NAMES, slideFor, viewOf, type View } from '../../lib/layout'
import { parseUrl } from '../../lib/parser'
import type { Settings } from '../../lib/settings'
import type { Item } from '../../lib/sources'
import { uid, type CardData, type FieldDef, type FieldType, type Preset } from '../../lib/types'
import { Card } from './Card'

export const FIELD_TYPES: Record<FieldType, string> = {
  image: 'Картинка',
  gallery: 'Галерея',
  title: 'Заголовок',
  description: 'Описание',
  text: 'Текст',
  badge: 'Бейдж',
  action: 'Кнопки / ссылки',
}

const DEFAULT_TYPE: Record<View, FieldType> = { 0: 'image', 1: 'description', 2: 'action' }

export interface ConstructorProps {
  settings: Settings
  presetId?: string
  testUrl?: string
  savePreset: (p: Preset) => void
  deletePreset: (id: string) => void
  createPreset: () => Preset
  sampleUrl: (match: string) => string | undefined
  openPicker: (url: string, preset?: Preset) => void
}

type TestState = { busy?: boolean; result?: Omit<CardData, 'id'>; error?: string }

export function Constructor({ settings, presetId, testUrl: initialUrl, savePreset, deletePreset, createPreset, sampleUrl, openPicker }: ConstructorProps) {
  const [selId, setSelId] = useState<string | undefined>(presetId ?? settings.presets[0]?.id)
  const stored = settings.presets.find((x) => x.id === selId)
  const [draft, setDraft] = useState<Preset | undefined>(stored && structuredClone(stored))
  const [testUrl, setTestUrl] = useState(initialUrl ?? (stored ? sampleUrl(stored.match) ?? '' : ''))
  const [test, setTest] = useState<TestState>({})
  const [aspect, setAspect] = useState('4 / 3')

  // switching presets: load its draft and a sample page
  const firstSel = useRef(true)
  useEffect(() => {
    const s = settings.presets.find((x) => x.id === selId)
    setDraft(s ? structuredClone(s) : undefined)
    if (firstSel.current) return void (firstSel.current = false)
    setTest({})
    setTestUrl(s ? sampleUrl(s.match) ?? '' : '')
  }, [selId])

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(stored)
  const set = (patch: Partial<Preset>) => setDraft((d) => d && { ...d, ...patch })
  const setField = (id: string, patch: Partial<FieldDef>) => setDraft((d) => d && { ...d, fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) })

  // Only the latest run may write the result: an older, slower request must not overwrite a newer one.
  const runSeq = useRef(0)
  const runTest = async (forceTab = false) => {
    if (!draft || !testUrl) return
    const seq = ++runSeq.current
    setTest((t) => ({ ...t, busy: true, error: undefined }))
    try {
      const result = await parseUrl(testUrl, [], { preset: draft, forceTab, interactive: true })
      if (seq === runSeq.current) setTest({ result })
    } catch (e) {
      if (seq === runSeq.current) setTest((t) => ({ result: t.result, error: e instanceof Error ? e.message : String(e) }))
    }
  }

  // Re-extract automatically when what/where to extract changes (layout changes need no re-run).
  const extractionKey = draft ? JSON.stringify([draft.mode, draft.fields.map((f) => [f.type, f.selector, f.attr, f.all, f.replaceFrom, f.replaceTo])]) : ''
  useEffect(() => {
    if (!draft || !testUrl || draft.mode === 'tab') return
    const t = setTimeout(() => runTest(), test.result ? 700 : 0)
    return () => clearTimeout(t)
  }, [extractionKey, testUrl])

  // ---- the three card views
  const sections: { view: View; hint: string }[] = [
    { view: COVER, hint: 'Картинка — обложка карточки, заголовок — подпись, бейджи — в углу.' },
    { view: HOVER, hint: 'Показывается при наведении: описание, тексты, бейджи, галерея.' },
    { view: ACTIONS, hint: 'Правый клик или «⋯»: «Открыть», ваши кнопки и инструменты.' },
  ]

  const addBlock = (view: View) =>
    setDraft((d) => d && { ...d, fields: [...d.fields, { id: uid(), type: DEFAULT_TYPE[view], label: '', selector: '', slide: slideFor(view) }] })
  const move = (id: string, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d
      const fields = [...d.fields]
      const i = fields.findIndex((f) => f.id === id)
      const v = viewOf(fields[i], fields)
      let j = i + dir
      while (j >= 0 && j < fields.length && viewOf(fields[j], fields) !== v) j += dir
      if (j < 0 || j >= fields.length) return d
      ;[fields[i], fields[j]] = [fields[j], fields[i]]
      return { ...d, fields }
    })
  /** while the cursor is over a zone, the preview shows that view; buttons under the preview pin one */
  const [pinned, setPinned] = useState<View | undefined>()
  const [previewView, setPreviewView] = useState<View | undefined>()

  // ---- preview
  const previewItem = useMemo<Item>(
    () => ({ key: 'preview', source: 'bookmark', title: test.result?.data?.title || 'Превью', url: testUrl || 'https://example.com', container: '', ancestors: [], dateAdded: 0, order: 0 }),
    [testUrl, test.result],
  )
  const previewCard = useMemo<CardData | undefined>(() => test.result && { id: testUrl, ...test.result }, [test.result])
  const foundIds = new Set(test.result?.data?.blocks?.map((b) => b.fieldId))
  const [lightbox, setLightbox] = useState<string>()

  return (
    <div className="constructor">
      <div className="preset-list">
        {settings.presets.map((x) => (
          <button key={x.id} className={x.id === selId ? 'on' : ''} onClick={() => setSelId(x.id)}>
            <span className={x.enabled ? '' : 'off'}>{x.name || x.match || 'Без названия'}</span>
            <small>{x.match}</small>
          </button>
        ))}
        <button className="add" onClick={() => setSelId(createPreset().id)}>
          + Новый пресет
        </button>
        <p className="hint">
          Пресет — конструктор карточки для сайта: какие блоки забрать со страницы и где их показать: на обложке, при наведении или в действиях. Быстрый старт — правый клик по карточке → ⌖ или ✎.
        </p>
      </div>

      {draft ? (
        <div className="cx-edit">
          <div className="grid2">
            <label>
              Название
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label>
              Для каких адресов
              <input className="mono" value={draft.match} placeholder="site.com  или  site.com/game/*" onChange={(e) => set({ match: e.target.value })} />
            </label>
            <label>
              Как загружать
              <select value={draft.mode === 'tab' ? 'tab' : 'auto'} onChange={(e) => set({ mode: e.target.value as Preset['mode'] })}>
                <option value="auto">Обычный запрос</option>
                <option value="tab">Через вкладку — только когда жмёшь ↻ на карточке (JS-сайты)</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Включён
            </label>
          </div>

          {sections.map((sec) => {
            const blocks = draft.fields.filter((f) => viewOf(f, draft.fields) === sec.view)
            return (
              <section className="cx-slide" key={sec.view} onMouseEnter={() => setPinned(sec.view)} onMouseLeave={() => setPinned(undefined)}>
                <div className="cx-slide-head">
                  <b>{VIEW_NAMES[sec.view]}</b>
                  <span className="hint-inline">{sec.hint}</span>
                </div>
                {blocks.map((f) => (
                  <BlockEditor
                    key={f.id}
                    f={f}
                    view={sec.view}
                    found={test.result ? foundIds.has(f.id) : undefined}
                    onChange={(p) => setField(f.id, p)}
                    onMove={(dir) => move(f.id, dir)}
                    onRemove={() => setDraft({ ...draft, fields: draft.fields.filter((x) => x.id !== f.id) })}
                  />
                ))}
                <button className="link" onClick={() => addBlock(sec.view)}>
                  + блок
                </button>
              </section>
            )
          })}

          <div className="foot">
            <button
              className="danger"
              onClick={() => {
                if (confirm(`Удалить пресет «${draft.name}»?`)) {
                  deletePreset(draft.id)
                  setSelId(undefined)
                }
              }}
            >
              Удалить пресет
            </button>
            <span className="grow" />
            {dirty && <button onClick={() => setDraft(stored && structuredClone(stored))}>Отменить</button>}
            <button className="primary" disabled={!dirty} onClick={() => savePreset(draft)}>
              Сохранить
            </button>
          </div>
        </div>
      ) : (
        <div className="cx-edit empty">Выбери пресет слева или создай новый.</div>
      )}

      {draft && (
        <div className="cx-preview">
          <input value={testUrl} placeholder="URL страницы для превью" onChange={(e) => setTestUrl(e.target.value)} />
          <div className="row-btns">
            <button onClick={() => runTest()} disabled={!testUrl || test.busy}>
              {test.busy ? 'Загружаю…' : 'Обновить'}
            </button>
            <button onClick={() => runTest(true)} disabled={!testUrl || test.busy} title="Открыть страницу в фоновой вкладке (для сайтов на JS)">
              Через вкладку
            </button>
            <button onClick={() => testUrl && openPicker(testUrl, draft)} disabled={!testUrl} title="Открыть страницу и выбрать элементы мышкой">
              ⌖ На странице
            </button>
          </div>
          <div className="aspect-switch">
            {['2 / 3', '4 / 3', '16 / 9'].map((a) => (
              <button key={a} className={aspect === a ? 'on' : ''} onClick={() => setAspect(a)}>
                {a.replace(/ /g, '')}
              </button>
            ))}
          </div>
          {test.error && <div className="err">{test.error}</div>}
          {previewCard ? (
            <div className="cx-card">
              <Card
                item={previewItem}
                card={previewCard}
                title={previewItem.title}
                aspect={aspect}
                fit={settings.imageFit}
                queued={false}
                preset={draft}
                forceView={pinned ?? previewView}
                onAction={(_, a, arg) => a === 'gallery' && arg && setLightbox(arg.images[arg.index])}
              />
              <div className="aspect-switch">
                {([COVER, HOVER, ACTIONS] as View[]).map((v) => (
                  <button key={v} className={(pinned ?? previewView) === v ? 'on' : ''} onClick={() => setPreviewView(previewView === v ? undefined : v)}>
                    {VIEW_NAMES[v]}
                  </button>
                ))}
              </div>
              <div className="hint">
                Наведи на зону слева — превью покажет этот вид. Раскладка обновляется сразу, селекторы — через секунду.
              </div>
            </div>
          ) : (
            !test.busy && <div className="hint">Укажи адрес страницы этого сайта, чтобы увидеть карточку.</div>
          )}
          {test.result?.data && (
            <details className="raw">
              <summary>Что нашлось (JSON)</summary>
              <pre>{JSON.stringify({ via: test.result.via, ...test.result.data }, null, 2)}</pre>
            </details>
          )}
          {lightbox && (
            <div className="lightbox" onClick={() => setLightbox(undefined)}>
              <img src={lightbox} referrerPolicy="no-referrer" alt="" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BlockEditor({ f, view, found, onChange, onMove, onRemove }: {
  f: FieldDef
  view: View
  found?: boolean
  onChange: (p: Partial<FieldDef>) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className={`cx-block ${found === false && f.selector ? 'missing' : ''}`}>
      <div className="cx-row">
        <select value={f.type} onChange={(e) => onChange({ type: e.target.value as FieldType })}>
          {Object.entries(FIELD_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          value={f.label}
          placeholder={f.type === 'action' ? 'Скачать  ·  Полная | Демо  ·  Скачать {text}' : 'Подпись (необязательно)'}
          title={
            f.type === 'action'
              ? 'Подпись кнопок.\n«Полная | Демо» — своя подпись каждой ссылке по порядку.\n«Скачать {text}» — шаблон: {text} = текст ссылки на сайте, {n} = номер.\nПусто — текст ссылки с сайта.'
              : undefined
          }
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <select value={view} title="Где показать" onChange={(e) => onChange({ slide: slideFor(+e.target.value as View) })}>
          {([COVER, HOVER, ACTIONS] as View[]).map((v) => (
            <option key={v} value={v}>
              {VIEW_NAMES[v]}
            </option>
          ))}
        </select>
        <button className="icon" title="Выше" onClick={() => onMove(-1)}>↑</button>
        <button className="icon" title="Ниже" onClick={() => onMove(1)}>↓</button>
        <button className="icon" title="Удалить блок" onClick={onRemove}>✕</button>
      </div>
      <div className="cx-row">
        <input className="mono grow" value={f.selector} placeholder="CSS-селектор, например .game-cover img" onChange={(e) => onChange({ selector: e.target.value })} />
        <input className="mono attr" value={f.attr ?? ''} placeholder="атрибут: авто" onChange={(e) => onChange({ attr: e.target.value || undefined })} />
        <label className="check-inline" title="Взять все совпадения, а не только первое">
          <input type="checkbox" checked={!!f.all || f.type === 'gallery'} disabled={f.type === 'gallery'} onChange={(e) => onChange({ all: e.target.checked || undefined })} /> все
        </label>
        {found !== undefined && f.selector && <span className={`found ${found ? 'ok' : 'no'}`} title={found ? 'Нашлось на странице' : 'На странице не нашлось'}>{found ? '●' : '○'}</span>}
      </div>
      {(f.type === 'image' || f.type === 'gallery') && (
        <div className="cx-row" title={'Если превью и оригинал отличаются кусочком адреса.\nНапример «/thumb/» → «/full/» или «_small» → пусто.\nМожно регулярное выражение: /_\\d+x\\d+/'}>
          <span className="cx-note">Замена в адресе</span>
          <input className="mono grow" value={f.replaceFrom ?? ''} placeholder="что, например /thumb/" onChange={(e) => onChange({ replaceFrom: e.target.value || undefined })} />
          <span className="cx-note">→</span>
          <input className="mono grow" value={f.replaceTo ?? ''} placeholder="на что, например /full/" onChange={(e) => onChange({ replaceTo: e.target.value || undefined })} />
        </div>
      )}
    </div>
  )
}
