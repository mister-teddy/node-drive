import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// https://vite.dev/config/
export default defineConfig({
  base: '.',
  plugins: [react()],
  build: {
    outDir: './dist', // Output to the dist/ directory
    emptyOutDir: true, // Clean the dist directory before building
    sourcemap: true, // Enable source maps for debugging
    rollupOptions: {
      input: {
        // Resolve path in an ESM-compatible way
        main: resolve(dirname(fileURLToPath(import.meta.url)), 'index.html'),
      },
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'main.css') {
            return 'index.css';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
})
