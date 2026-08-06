import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Config dos testes de integração de banco. Separada da config padrão porque
 * estes testes precisam de um Supabase acessível (URL + chaves em `.env.test`)
 * e rodam em ambiente node, em série — vários deles criam usuários e conferem
 * o estado persistido, então paralelismo só geraria ruído.
 *
 * Uso: `pnpm test:db`
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
