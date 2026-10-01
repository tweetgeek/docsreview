import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'src/web',
  plugins: [vue()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:4477', changeOrigin: true } } },
});
