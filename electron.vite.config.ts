import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

// windows.ts resolves the window icon as `<main out dir>/../icon.png` (i.e.
// `out/icon.png`), mirroring the sibling products' convention of shipping
// the icon at the output root next to main/preload/renderer.
function copyIconPlugin(): Plugin {
  return {
    name: 'calco-copy-icon',
    closeBundle() {
      const dest = resolve('out/icon.png')
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(resolve('build/icon.png'), dest)
    }
  }
}

function cspPlugin(): Plugin {
  return {
    name: 'calco-csp',
    transformIndexHtml(html, ctx) {
      const isDev = ctx.server !== undefined
      const csp = isDev
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:*; img-src 'self' data:;"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
      return html.replace('%CALCO_CSP%', csp)
    }
  }
}

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: { output: { format: 'cjs' } }
    },
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [copyIconPlugin()]
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: { output: { format: 'cjs' } }
    },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          splash: resolve('src/renderer/splash.html')
        }
      }
    },
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [cspPlugin()]
  }
})
