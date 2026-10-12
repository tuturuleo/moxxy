import { useEffect, useState } from 'react'
import { clearImageCache } from '../../lib/imagecache'
import { suggestMatch } from '../../lib/presets'
import type { Settings } from '../../lib/settings'
import { uid, type Preset } from '../../lib/types'
import { checkForUpdate, repoUrl, type UpdateInfo } from '../../lib/updates'
import { Constructor, type ConstructorProps } from './Constructor'

interface Props extends ConstructorProps {
  tab: 'presets' | 'general'
  update: (patch: Partial<Settings>) => void
  reparseAll: () => void
  onClose: () => void
}

export const newPreset = (url = ''): Preset => ({
  id: uid(),
  name: url ? suggestMatch(url).split('/')[0] : 'Новый пресет',
  match: url ? suggestMatch(url) : '',
  mode: 'auto',
  enabled: true,
  fields: [],
})

export function SettingsModal(p: Props) {
  const [tab, setTab] = useState(p.tab)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="modal-back" onMouseDown={p.onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="tabs">
            <button className={tab === 'presets' ? 'on' : ''} onClick={() => setTab('presets')}>Конструктор карточек</button>
            <button className={tab === 'general' ? 'on' : ''} onClick={() => setTab('general')}>Общие</button>
          </div>
          <button className="icon" onClick={p.onClose}>✕</button>
        </div>
        {tab === 'presets' ? <Constructor {...p} /> : <GeneralTab {...p} />}
      </div>
    </div>
  )
}

function AboutBlock() {
  const repo = repoUrl()
  const [state, setState] = useState<{ busy?: boolean; info?: UpdateInfo | null; error?: string }>({})
  const check = async () => {
    setState({ busy: true })
    try {
      setState({ info: await checkForUpdate(true) })
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <div className="about">
      <div>
        <b>Moxxy {chrome.runtime.getManifest().version}</b>
        {repo && (
          <>
            {' · '}
            <a href={repo} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </>
        )}
      </div>
      {repo && (
        <div className="row-btns">
          <button onClick={check} disabled={state.busy}>
            {state.busy ? 'Проверяю…' : 'Проверить обновления'}
          </button>
          {state.info === null && <span className="hint">Релизов пока нет</span>}
          {state.info && !state.info.newer && <span className="hint">Установлена последняя версия</span>}
          {state.error && <span className="err">{state.error}</span>}
        </div>
      )}
      {state.info?.newer && <UpdateNote info={state.info} />}
    </div>
  )
}

export function UpdateNote({ info }: { info: UpdateInfo }) {
  return (
    <div className="update-note">
      Доступна версия <b>{info.latest}</b> (у тебя {info.current}).{' '}
      <a href={info.downloadUrl} target="_blank" rel="noreferrer">
        Скачать zip
      </a>
      , распакуй его поверх папки расширения и нажми ↻ у Moxxy в chrome://extensions.{' '}
      <a href={info.pageUrl} target="_blank" rel="noreferrer">
        Что нового
      </a>
    </div>
  )
}

function GeneralTab({ settings, update, reparseAll }: Props) {
  return (
    <div className="general">
      <AboutBlock />
      <p className="hint" style={{ margin: 0, padding: 0 }}>
        Карточка: наведение — описание, правый клик или кнопка «⋯» — действия (повторный правый клик — обратно).
        Обычное меню браузера: Shift + правый клик.
      </p>
      <label>
        Заголовок карточки
        <select value={settings.titleSource} onChange={(e) => update({ titleSource: e.target.value as Settings['titleSource'] })}>
          <option value="bookmark">Название закладки / вкладки</option>
          <option value="page">Заголовок со страницы</option>
        </select>
      </label>
      <label>
        Обновлять данные карточек раз в (дней)
        <input type="number" min={1} max={365} value={settings.staleDays} onChange={(e) => update({ staleDays: Math.max(1, +e.target.value || 30) })} />
      </label>
      <div className="row-btns">
        <button onClick={reparseAll}>Перезагрузить все карточки (все группы и закладки)</button>
        <button
          title="Картинки скачаются заново при следующем показе"
          onClick={async () => {
            await clearImageCache()
            location.reload()
          }}
        >
          Очистить кэш картинок
        </button>
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(settings.presets, null, 2)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = 'moxxy-presets.json'
            a.click()
          }}
        >
          Экспорт пресетов
        </button>
        <label className="btn-like">
          Импорт пресетов
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                const list = JSON.parse(await f.text()) as Preset[]
                const byId = new Map(settings.presets.map((x) => [x.id, x]))
                list.forEach((x) => x?.id && x.match && byId.set(x.id, x))
                update({ presets: [...byId.values()] })
              } catch {
                alert('Не похоже на файл пресетов')
              }
            }}
          />
        </label>
      </div>
    </div>
  )
}
