import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** 独立 Web / Capacitor 构建（与 electron-vite 并存） */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [vue()],
  build: {
    outDir: resolve(__dirname, 'dist-mobile'),
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    port: 5174,
    strictPort: true
  }
})