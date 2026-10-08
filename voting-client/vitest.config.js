import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Component specs run under Vitest because they need a DOM and a JSX
// transform. The logic and integration specs stay on `node --test`, which is
// what `npm test` runs, so the two suites never load each other's files.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/vitest.setup.js'],
    // Only the component specs. `npm test` owns the rest of test/.
    include: ['test/**/*.test.jsx'],
    restoreMocks: true,
    clearMocks: true
  }
})
