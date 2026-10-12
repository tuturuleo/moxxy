// Visual selector picker. Injected into a site tab by Moxxy (chrome.scripting.executeScript).
// Hover highlights elements, click locks one, then the user assigns it a role (cover, description,
// download button...). "Save" sends the preset back to the Moxxy page.
// Must stay import-free: it is emitted as a standalone classic script.

type FieldType = 'image' | 'gallery' | 'title' | 'description' | 'text' | 'badge' | 'action'
interface FieldDef { id: string; label: string; type: FieldType; selector: string; attr?: string; all?: boolean; slide?: number }
interface Preset { id: string; name: string; match: string; mode: 'auto' | 'fetch' | 'tab'; enabled: boolean; fields: FieldDef[]; slideCount?: number }

;(() => {
  const w = window as any
  if (w.__moxxyPickerActive) return
  w.__moxxyPickerActive = true

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  // `slide` mirrors FieldDef.slide: 0 = cover, undefined = auto (rearranged later in the constructor).
  const ROLES: { key: string; type: FieldType; label: string; multi?: boolean; single?: boolean; slide?: number }[] = [
    { key: 'cover', type: 'image', label: 'Обложка', single: true, slide: 0 },
    { key: 'image', type: 'image', label: 'Картинка' },
    { key: 'gallery', type: 'gallery', label: 'Галерея', multi: true },
    { key: 'title', type: 'title', label: 'Заголовок', single: true },
    { key: 'description', type: 'description', label: 'Описание' },
    { key: 'text', type: 'text', label: 'Текст' },
    { key: 'badge', type: 'badge', label: 'Бейдж' },
    { key: 'action', type: 'action', label: 'Кнопка / ссылка' },
  ]
  const TYPE_LABEL: Record<FieldType, string> = { image: 'Картинка', gallery: 'Галерея', title: 'Заголовок', description: 'Описание', text: 'Текст', badge: 'Бейдж', action: 'Кнопка' }
  const fieldLabel = (f: FieldDef) => (f.type === 'image' && f.slide === 0 ? 'Обложка' : f.label || TYPE_LABEL[f.type])

  const init = w.__moxxyPickerInit || {}
  const host = location.hostname.replace(/^www\./, '')
  const preset: Preset = init.preset
    ? JSON.parse(JSON.stringify(init.preset))
    : { id: uid(), name: host, match: host, mode: 'auto', enabled: true, fields: [] }

  // ---------- selector generation
  const BAD_CLASS = /\d{3,}|^(css|sc|jsx|svelte|emotion|tw)-|^(is|has)-|active|hover|focus|selected|current|open|visible|hidden|[:[\]/@]/
  const goodClass = (c: string) => c.length > 1 && c.length < 40 && !BAD_CLASS.test(c)
  const goodId = (id: string) => !!id && id.length < 40 && !/\d{3,}|^\d|[:.]/.test(id)
  const count = (sel: string) => {
    try {
      return document.querySelectorAll(sel).length
    } catch {
      return 0
    }
  }
  const seg = (el: Element) => {
    const cls = Array.from(el.classList).filter(goodClass).slice(0, 2)
    return el.tagName.toLowerCase() + cls.map((c) => '.' + CSS.escape(c)).join('')
  }
  const exactPath = (el: Element) => {
    const parts: string[] = []
    let cur: Element | null = el
    while (cur && cur !== document.documentElement) {
      if (goodId(cur.id)) {
        parts.unshift('#' + CSS.escape(cur.id))
        break
      }
      const p: Element | null = cur.parentElement
      let s = cur.tagName.toLowerCase()
      const tag = cur.tagName
      const sibs = p ? Array.from(p.children).filter((c) => c.tagName === tag) : []
      if (sibs.length > 1) s += `:nth-of-type(${sibs.indexOf(cur) + 1})`
      parts.unshift(s)
      cur = p
    }
    return parts.join(' > ')
  }
  /** unique: points at this element; similar: class-based, may match its siblings (lists, galleries). */
  function buildSelectors(el: Element): { unique: string; similar: string } {
    if (goodId(el.id) && count('#' + CSS.escape(el.id)) === 1) {
      const s = '#' + CSS.escape(el.id)
      return { unique: s, similar: s }
    }
    const parts: string[] = []
    let similar = ''
    let cur: Element | null = el
    while (cur && cur !== document.body && cur !== document.documentElement && parts.length < 6) {
      if (cur !== el && goodId(cur.id)) {
        parts.unshift('#' + CSS.escape(cur.id))
        const s = parts.join(' ')
        if (!similar) similar = s
        if (count(s) === 1) return { unique: s, similar }
        break
      }
      parts.unshift(seg(cur))
      const s = parts.join(' ')
      if (!similar && parts.length >= 2 && parts.some((p) => p.includes('.'))) similar = s
      if (count(s) === 1) return { unique: s, similar: similar || s }
      cur = cur.parentElement
    }
    return { unique: exactPath(el), similar: similar || parts.join(' ') }
  }

  const imgOf = (el: Element): string => {
    const img = el.tagName === 'IMG' ? (el as HTMLImageElement) : el.querySelector('img')
    if (img) return img.currentSrc || img.src
    const bg = getComputedStyle(el).backgroundImage.match(/url\((['"]?)(.*?)\1\)/)
    return bg ? bg[2] : ''
  }
  const linkOf = (el: Element) => ((el.closest('a[href]') || el.querySelector('a[href]')) as HTMLAnchorElement | null)?.href || el.getAttribute('href') || ''
  const textOf = (el: Element) => ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim()

  // ---------- UI (shadow DOM so site CSS can't touch it)
  const hostEl = document.createElement('div')
  hostEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
  const root = hostEl.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(hostEl)
  root.innerHTML = `
  <style>
    :host { all: initial }
    * { box-sizing: border-box; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif }
    .hl { position: fixed; pointer-events: none; border: 2px solid #8ab4ff; background: rgba(138,180,255,.15); border-radius: 3px; transition: all .05s }
    .hl.lock { border-color: #c6f432; background: rgba(198,244,50,.14) }
    .hl.sib { border: 1px dashed #c6f432; background: transparent }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 380px; max-height: 80vh; overflow: auto; pointer-events: auto;
      background: #141518; color: #e8e8ea; border: 1px solid #2a2c31; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.5); padding: 12px }
    .panel.left { right: auto; left: 16px }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px }
    .head b { flex: 1; font-weight: 600 }
    input, select { width: 100%; background: #0e0f11; color: #e8e8ea; border: 1px solid #2a2c31; border-radius: 6px; padding: 5px 7px; outline: none }
    input:focus, select:focus { border-color: #8ab4ff }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px }
    label { display: block; color: #8b8d94; font-size: 11px; margin: 6px 0 2px }
    button { background: #23252a; color: #e8e8ea; border: 1px solid #2f3238; border-radius: 6px; padding: 5px 9px; cursor: pointer }
    button:hover { background: #2c2f35 }
    button.primary { background: #c6f432; color: #111; border-color: #c6f432; font-weight: 600 }
    button.ghost { background: transparent; border-color: transparent; color: #8b8d94 }
    .roles { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px }
    .sel { border-top: 1px solid #23252a; margin-top: 10px; padding-top: 8px }
    .muted { color: #8b8d94; font-size: 12px }
    .preview { margin-top: 6px; color: #b9bbc2; font-size: 12px; max-height: 80px; overflow: hidden; word-break: break-all }
    .preview img { max-width: 100%; max-height: 90px; border-radius: 6px; display: block }
    .fields { margin-top: 10px; border-top: 1px solid #23252a; padding-top: 6px }
    .f { display: flex; gap: 6px; align-items: center; padding: 3px 0 }
    .f span.t { color: #c6f432; white-space: nowrap; font-size: 12px }
    .f code { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #8b8d94; font: 11px ui-monospace, Consolas, monospace }
    .line { display: flex; gap: 6px; align-items: center; margin-top: 6px }
    .foot { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px }
  </style>
  <div class="hl" style="display:none"></div>
  <div class="sibs"></div>
  <div class="panel"></div>`
  const hl = root.querySelector('.hl') as HTMLDivElement
  const sibsBox = root.querySelector('.sibs') as HTMLDivElement
  const panel = root.querySelector('.panel') as HTMLDivElement

  let picking = true
  let locked: Element | null = null
  /** Image element under the click point, for when the click lands on an overlay above a picture. */
  let under: Element | null = null
  let sels = { unique: '', similar: '' }
  let selector = ''
  let useAll = false
  let label = ''
  let saved = false

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const place = (box: HTMLElement, el: Element) => {
    const r = el.getBoundingClientRect()
    box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`
  }
  const drawMatches = () => {
    sibsBox.innerHTML = ''
    if (!locked || !selector) return
    let els: Element[] = []
    try {
      els = Array.from(document.querySelectorAll(selector)).slice(0, 60)
    } catch {}
    for (const el of els) {
      if (el === locked) continue
      const b = document.createElement('div')
      b.className = 'hl sib'
      place(b, el)
      sibsBox.appendChild(b)
    }
  }

  function render() {
    const n = selector ? count(selector) : 0
    let preview = ''
    if (locked) {
      const img = imgOf(locked) || (under ? imgOf(under) : '')
      const link = linkOf(locked)
      const txt = textOf(locked).slice(0, 160)
      preview = (img ? `<img src="${esc(img)}">` : '') + (txt ? `<div>${esc(txt)}</div>` : '') + (link ? `<div class="muted">${esc(link)}</div>` : '')
    }
    panel.innerHTML = `
      <div class="head"><b>Moxxy · пресет</b>
        <button class="ghost" data-act="side" title="Переместить панель">⇆</button>
        <button data-act="pause">${picking ? '⏸ Пауза' : '▶ Выбирать'}</button>
      </div>
      <div class="row2">
        <div><label>Название</label><input data-k="name" value="${esc(preset.name)}"></div>
        <div><label>Адреса (site.com или site.com/game/*)</label><input data-k="match" class="mono" value="${esc(preset.match)}"></div>
      </div>
      <label>Как загружать</label>
      <select data-k="mode">
        <option value="auto"${preset.mode !== 'tab' ? ' selected' : ''}>Обычный запрос</option>
        <option value="tab"${preset.mode === 'tab' ? ' selected' : ''}>Через вкладку — только по ↻ на карточке</option>
      </select>
      <div class="sel">
        ${
          locked
            ? `<label>Селектор · совпадений: ${n}</label>
               <input data-k="selector" class="mono" value="${esc(selector)}">
               <div class="line">
                 <button data-act="up" title="Выбрать родительский элемент">↑ шире</button>
                 <label style="margin:0;display:flex;gap:4px;align-items:center;color:#e8e8ea;font-size:12px">
                   <input type="checkbox" data-k="all" style="width:auto"${useAll ? ' checked' : ''}> все похожие
                 </label>
                 <span style="flex:1"></span>
                 <button class="ghost" data-act="unlock">✕</button>
               </div>
               <div class="preview">${preview}</div>
               <label>Подпись (для кнопок, бейджей, текста)</label>
               <input data-k="label" value="${esc(label)}" placeholder="Скачать  ·  Полная | Демо  ·  Скачать {text}">
               <div class="roles">${ROLES.map((r) => `<button data-role="${r.key}">${r.label}</button>`).join('')}</div>
               <div class="muted" style="margin-top:6px">Блоков каждого вида может быть сколько угодно. Где показать блок (обложка, наведение, действия) можно поменять в конструкторе ✎.</div>`
            : `<div class="muted">${picking ? 'Наведи на элемент страницы и кликни. Esc — снять выбор.' : 'Пауза: страница работает как обычно (можно залогиниться, раскрыть спойлер).'}</div>`
        }
      </div>
      <div class="fields">
        ${
          preset.fields.length
            ? preset.fields
                .map((f, i) => `<div class="f"><span class="t">${esc(fieldLabel(f))}${f.all ? ' ×N' : ''}</span><code title="${esc(f.selector)}">${esc(f.selector)}</code><button class="ghost" data-del="${i}">✕</button></div>`)
                .join('')
            : '<div class="muted">Пока ничего не выбрано. Без полей карточка возьмёт стандартные данные страницы.</div>'
        }
      </div>
      <div class="foot">
        <button data-act="cancel">Отмена</button>
        <button class="primary" data-act="save">${saved ? 'Сохранено ✓' : 'Сохранить пресет'}</button>
      </div>`
    drawMatches()
  }

  const lock = (el: Element) => {
    locked = el
    sels = buildSelectors(el)
    selector = useAll ? sels.similar : sels.unique
    place(hl, el)
    hl.classList.add('lock')
    render()
  }
  const unlock = () => {
    locked = null
    selector = ''
    hl.classList.remove('lock')
    hl.style.display = 'none'
    render()
  }
  const inPanel = (e: Event) => e.composedPath().includes(hostEl)

  const onMove = (e: MouseEvent) => {
    if (!picking || locked || inPanel(e)) return
    const el = e.target as Element
    if (el && el.nodeType === 1) place(hl, el)
  }
  const block = (e: Event) => {
    if (!picking || inPanel(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }
  const onClick = (e: MouseEvent) => {
    if (!picking || inPanel(e)) return
    block(e)
    const target = e.target as Element
    under = imgOf(target) ? null : document.elementsFromPoint(e.clientX, e.clientY).find((el) => !hostEl.contains(el) && el !== hostEl && !!imgOf(el)) ?? null
    lock(target)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && locked) unlock()
  }
  const onScroll = () => {
    if (locked) place(hl, locked)
    drawMatches()
  }
  document.addEventListener('mousemove', onMove, true)
  ;['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick'].forEach((t) => document.addEventListener(t, block, true))
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('scroll', onScroll, true)

  const teardown = () => {
    document.removeEventListener('mousemove', onMove, true)
    ;['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick'].forEach((t) => document.removeEventListener(t, block, true))
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('scroll', onScroll, true)
    hostEl.remove()
    w.__moxxyPickerActive = false
  }

  panel.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    const k = t.dataset.k
    if (k === 'name') preset.name = t.value
    else if (k === 'match') preset.match = t.value
    else if (k === 'mode') preset.mode = t.value as Preset['mode']
    else if (k === 'label') label = t.value
    else if (k === 'selector') {
      selector = t.value
      drawMatches()
    } else if (k === 'all') {
      useAll = t.checked
      selector = useAll ? sels.similar : sels.unique
      render()
    }
  })
  panel.addEventListener('click', async (e) => {
    const b = (e.target as Element).closest('button') as HTMLButtonElement | null
    if (!b) return
    const act = b.dataset.act
    if (b.dataset.role && locked && selector) {
      const role = ROLES.find((r) => r.key === b.dataset.role)!
      // Clicked a transparent overlay: use the picture underneath for image roles.
      // (only when the user didn't type their own selector)
      if (selector === sels.unique || selector === sels.similar) {
        if ((role.type === 'image' || role.type === 'gallery') && !imgOf(locked) && under) sels = buildSelectors(under)
        // a gallery needs a selector matching all the similar pictures, not just the clicked one
        selector = role.multi || useAll ? sels.similar : sels.unique
      }
      const f: FieldDef = {
        id: uid(),
        type: role.type,
        label: label.trim() || (role.type === 'action' ? 'Ссылка' : ''),
        selector,
        all: role.multi || useAll || undefined,
        slide: role.slide,
      }
      if (role.single) preset.fields = preset.fields.filter((x) => !(x.type === role.type && x.slide === role.slide))
      preset.fields.push(f)
      label = ''
      saved = false
      unlock()
      return
    }
    if (b.dataset.del) {
      preset.fields.splice(+b.dataset.del, 1)
      saved = false
      render()
      return
    }
    if (act === 'pause') {
      picking = !picking
      if (!picking) unlock()
      else render()
    } else if (act === 'side') panel.classList.toggle('left')
    else if (act === 'unlock') unlock()
    else if (act === 'up' && locked?.parentElement && locked.parentElement !== document.body) lock(locked.parentElement)
    else if (act === 'cancel') teardown()
    else if (act === 'save') {
      try {
        await chrome.runtime.sendMessage({ type: 'moxxy:picker-save', preset })
      } catch {
        // No Moxxy tab open to receive it — park it; Moxxy picks it up on next start.
        const r = await chrome.storage.local.get('pickerInbox')
        await chrome.storage.local.set({ pickerInbox: [...(r.pickerInbox || []).filter((x: Preset) => x.id !== preset.id), preset] })
      }
      saved = true
      render()
    }
  })

  render()
})()
