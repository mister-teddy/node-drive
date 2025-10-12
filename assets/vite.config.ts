import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: './dist', // Output to the dist/ directory
    emptyOutDir: true, // Clean the dist directory before building
    sourcemap: true, // Enable source maps for debugging
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/main.tsx'),
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
