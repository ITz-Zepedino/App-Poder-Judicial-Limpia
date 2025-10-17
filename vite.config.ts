import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    build({
      // Externos críticos: Playwright y dependencias nativas no deben empaquetarse
      external: [
        'playwright',
        'playwright-core',
        'cheerio',
        '@google/generative-ai'
      ],
      // Configuración de salida optimizada
      minify: true,
    }),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ],
  // Configuración SSR para el servidor Node.js
  ssr: {
    // Excluir módulos que no deben ser empaquetados
    external: [
      'playwright',
      'playwright-core',
      'cheerio',
      '@google/generative-ai'
    ],
    // No intentar optimizar estos módulos
    noExternal: false
  },
  // Optimizaciones de build
  build: {
    // Tamaño máximo de chunk (en KB)
    chunkSizeWarningLimit: 1000,
    // Optimización de código
    minify: 'esbuild',
    // Source maps solo en desarrollo
    sourcemap: false,
    // Output limpio
    emptyOutDir: true
  },
  // Resolución de módulos
  resolve: {
    alias: {
      // Alias para imports más limpios
      '@': '/src'
    }
  }
})