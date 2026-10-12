// Dev-only: fakes the chrome.* APIs Moxxy uses so the UI can be checked in a normal browser tab.
// Not part of the extension build. Serve the dist/ folder + this file, open dev/mock.html.
;(() => {
  const img = (seed, w, h) => `https://picsum.photos/seed/${seed}/${w}/${h}`
  const games = ['Hollow Knight', 'Disco Elysium', 'Outer Wilds', 'Hades', 'Celeste', 'Factorio', 'Rimworld', 'Inscryption', 'Tunic', 'Dead Cells']
  const movies = ['Дюна', 'Интерстеллар', 'Бегущий по лезвию 2049', 'Прибытие', 'Паразиты', 'Однажды в Голливуде', 'Остров проклятых', 'Начало']
  const books = ['Солярис', 'Пикник на обочине', 'Гиперион', 'Ложная слепота', 'Задача трёх тел', 'Дюна (книга)']
  let id = 100
  const tabs = []
  const groups = [
    { id: 1, title: 'Поиграть', color: 'green', windowId: 1, collapsed: false },
    { id: 2, title: 'Посмотреть', color: 'blue', windowId: 1, collapsed: true },
    { id: 3, title: 'Почитать', color: 'orange', windowId: 1, collapsed: true },
  ]
  const add = (list, groupId, kind) =>
    list.forEach((t, i) =>
      tabs.push({ id: ++id, windowId: 1, index: tabs.length, groupId, title: t, url: `https://example-${kind}.test/item/${i}?t=${encodeURIComponent(t)}`, status: i % 3 ? 'unloaded' : 'complete', discarded: i % 3 !== 0 }),
    )
  // #reorder: the "Почитать" group stands first in the tab strip although it was created last
  if (location.hash.includes('reorder')) add(books, 3, 'books')
  add(games, 1, 'games')
  add(movies, 2, 'movies')
  if (!location.hash.includes('reorder')) add(books, 3, 'books')
  // duplicates: same pages with tracking params / hash, opened in other groups
  const dup = (src, groupId, suffix) => tabs.push({ ...tabs.find((t) => t.title === src), id: ++id, groupId, index: tabs.length, url: tabs.find((t) => t.title === src).url + suffix })
  dup('Hollow Knight', 2, '&utm_source=reddit')
  dup('Hollow Knight', 3, '#reviews')
  dup('Hades', 1, '&utm_medium=x')

  const tree = [{ id: '0', title: '', children: [
    { id: '1', title: 'Панель закладок', children: [
      { id: '10', title: 'Работа', children: [
        { id: '11', title: 'GitHub', url: 'https://github.com' },
        { id: '12', title: 'MDN', url: 'https://developer.mozilla.org' },
      ] },
      { id: '13', title: 'YouTube', url: 'https://www.youtube.com' },
    ] },
    { id: '2', title: 'Другие закладки', children: [] },
  ] }]

  const fixture = (url) => {
    const u = new URL(url)
    const title = u.searchParams.get('t') || u.hostname
    const kind = u.hostname.split('-')[1]?.split('.')[0]
    const n = u.pathname.split('/').pop()
    const [w, h] = kind === 'games' ? [640, 360] : [400, 600]
    const gallery = kind === 'games' ? [1, 2, 3, 4, 5, 6, 7].map((k) => `<a class="shot" href="${img(title + k, 1280, 720)}"><img src="${img(title + k, 320, 180)}"></a>`).join('') : ''
    const ld = { '@context': 'https://schema.org', '@type': kind === 'games' ? 'VideoGame' : kind === 'movies' ? 'Movie' : 'Book', name: title,
      aggregateRating: { ratingValue: (7 + (+n % 3) * 0.6).toFixed(1) }, datePublished: `${2010 + +n}-01-01`, genre: kind === 'games' ? ['Метроидвания', 'Инди'] : ['Фантастика', 'Драма'] }
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title} — ${kind}</title>
      <meta property="og:title" content="${title}"><meta property="og:image" content="${img(title, w, h)}">
      <meta property="og:description" content="${title}: длинное описание страницы, которое сайт отдаёт в OpenGraph. Тут сюжет, особенности, системные требования и всё такое. Второе предложение, чтобы проверить обрезку текста в карточке.">
      <script type="application/ld+json">${JSON.stringify(ld)}</script></head>
      <body><main><h1>${title}</h1><div class="gallery">${gallery}</div>
      <a class="dl" href="magnet:?xt=urn:btih:${n}abc">Скачать торрент</a><a class="dl" href="https://example-${kind}.test/dl/${n}.zip">Скачать с зеркала</a>
      <span class="size">${(+n + 1) * 3} ГБ</span></main></body></html>`
  }
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (/^https:\/\/example-/.test(url)) {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 900))
      return new Response(fixture(url), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }
    // images: real request (without cookies — a normal page can't do credentialed CORS like the extension can)
    if (/^https:\/\/picsum\.photos\//.test(url)) return realFetch(url)
    if (/^https?:/.test(url)) return new Response('<html><head><title>x</title></head></html>', { headers: { 'content-type': 'text/html' } })
    return realFetch(input, init)
  }

  const ev = () => ({ addListener() {}, removeListener() {} })
  const store = {}
  // open with #seed to start with a ready-made constructor preset for the fake game site
  if (location.hash.includes('seed'))
    store.settings = {
      presets: [{
        id: 'games', name: 'Игры (тест)', match: 'example-games.test', mode: 'auto', enabled: true, slideCount: 2,
        fields: [
          { id: 'g', type: 'gallery', label: '', selector: '.gallery a', slide: 1 },
          { id: 's', type: 'badge', label: 'Размер', selector: '.size', slide: 2 },
          { id: 'd', type: 'action', label: 'Скачать', selector: 'a.dl', all: true, slide: 2 },
        ],
      }],
    }
  const findNode = (nodes, nid) => {
    for (const n of nodes) {
      if (n.id === nid) return n
      const r = n.children && findNode(n.children, nid)
      if (r) return r
    }
  }
  window.chrome = {
    runtime: { getURL: (p) => (p.startsWith('/_favicon') ? `https://www.google.com/s2/favicons?domain=${new URL(decodeURIComponent(p.split('pageUrl=')[1].split('&')[0])).hostname}&sz=64` : p), onMessage: ev(), sendMessage: async () => {} },
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o), remove: async (k) => delete store[k] } },
    bookmarks: { getTree: async () => structuredClone(tree), getSubTree: async (i) => [structuredClone(findNode(tree, i))], getChildren: async (i) => findNode(tree, i)?.children ?? [],
      onCreated: ev(), onRemoved: ev(), onChanged: ev(), onMoved: ev(), onChildrenReordered: ev(), onImportEnded: ev(), create: async (b) => ({ id: String(++id), ...b }), update: async () => {}, remove: async () => {}, move: async () => {} },
    tabGroups: { query: async () => groups, get: async (g) => groups.find((x) => x.id === g), onCreated: ev(), onUpdated: ev(), onRemoved: ev(), onMoved: ev() },
    tabs: { query: async () => tabs, get: async (t) => tabs.find((x) => x.id === t), update: async () => ({}), remove: async () => {}, create: async () => ({ id: ++id }), group: async () => {}, getCurrent: (cb) => cb(undefined),
      onCreated: ev(), onRemoved: ev(), onMoved: ev(), onAttached: ev(), onDetached: ev(), onReplaced: ev(), onUpdated: ev() },
    windows: { update: async () => {} },
    // live-tab extraction fails in the mock → parser falls back to fetch
    scripting: { executeScript: async () => { throw new Error('mock') } },
  }
})()
