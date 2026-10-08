import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Read VITE_* variables from the single repo-root .env (the same file the
  // server uses) instead of requiring a second env file inside the package.
  envDir: '..',
})
