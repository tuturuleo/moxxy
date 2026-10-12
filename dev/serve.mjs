// Dev-only static server: GET / → dist/app.html with the chrome.* mock injected.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = join(import.meta.dirname, '..')
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json' }
const port = +(process.env.PORT || 5178)

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (path === '/') {
      const html = (await readFile(join(root, 'dist/app.html'), 'utf8'))
        .replaceAll('./assets/', '/dist/assets/')
        .replace('<head>', '<head><script src="/dev/mock-chrome.js"></script>')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(html)
    }
    const file = normalize(join(root, path))
    if (!file.startsWith(root)) throw new Error('outside root')
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(port, () => console.log(`mock UI on http://localhost:${port}`))
