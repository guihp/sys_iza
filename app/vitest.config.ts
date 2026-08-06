import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // tests/db/ exige um Supabase acessível — roda via `pnpm test:db`,
    // com vitest.db.config.ts. `pnpm test` fica sendo só o que roda offline.
    exclude: ['node_modules/**', 'tests/db/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
