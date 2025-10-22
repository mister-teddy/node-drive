import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: 'esbuild', // Use esbuild for faster minification (Vite default)
    target: 'es2015', // Target modern browsers for smaller bundle
    rollupOptions: {
      input: {
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
        // Include original source content in sourcemaps
        sourcemapExcludeSources: false,
        // Manually chunk vendor libraries for better caching
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // Split large libraries into separate chunks
            if (id.includes('@ant-design/icons')) {
              return 'antd-icons';
            }
            if (id.includes('antd')) {
              return 'antd';
            }
            if (id.includes('@uppy')) {
              return 'uppy';
            }
            if (id.includes('react-router-dom')) {
              return 'react-router';
            }
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react';
            }
            if (id.includes('jotai')) {
              return 'jotai';
            }
            // All other vendor code
            return 'vendor';
          }
        },
      },
    },
    // Increase chunk size warning limit (we're chunking it properly now)
    chunkSizeWarningLimit: 600,
  },
})
