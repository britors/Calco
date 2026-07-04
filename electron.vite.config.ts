import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

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
    resolve: { alias: { '@shared': resolve('src/shared') } }
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
    build: { outDir: 'out/renderer' },
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [cspPlugin()]
  }
})
