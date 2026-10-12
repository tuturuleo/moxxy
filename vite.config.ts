import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = import.meta.dirname

/** package.json is the single source of the version and the repo link: stamp them into dist/manifest.json. */
function stampManifest(): Plugin {
  return {
    name: 'moxxy-stamp-manifest',
    closeBundle() {
      const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
      const file = resolve(root, 'dist/manifest.json')
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      manifest.version = pkg.version
      if (pkg.homepage) manifest.homepage_url = pkg.homepage
      else delete manifest.homepage_url
      writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
    },
  }
}

// Three entries: the full-screen app page, the service worker and the element picker
// (injected into sites via chrome.scripting). Background and picker get fixed names
// because manifest.json and executeScript reference them by path.
export default defineConfig({
  plugins: [react(), stampManifest()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    minify: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        app: resolve(root, 'app.html'),
        background: resolve(root, 'src/background.ts'),
        picker: resolve(root, 'src/picker/picker.ts'),
      },
      output: {
        entryFileNames: (c) => (c.name === 'app' ? 'assets/[name]-[hash].js' : '[name].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
