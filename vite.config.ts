import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))
const realClient = resolve(root, 'src/lib/supabase')
const demoClient = resolve(root, 'src/demo/supabase.ts')

// `vite --mode demo` (or TPL_DEMO=1) swaps the Supabase client for the in-browser demo backend in src/demo.
function demoBackend(): Plugin {
  return {
    name: 'tpl-demo-backend',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null
      const target = resolve(dirname(importer), source).replace(/\.ts$/, '')
      return target === realClient ? demoClient : null
    },
    transformIndexHtml(html) {
      return html.replace('<title>', '<title>DEMO (synthetic data) · ')
    },
  }
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo' || process.env.TPL_DEMO === '1'
  return {
    plugins: [react(), ...(demo ? [demoBackend()] : [])],
    define: { 'import.meta.env.VITE_TPL_DEMO': JSON.stringify(demo ? '1' : '') },
    test: {
      include: ['src/**/*.test.ts'],
    },
  }
})
