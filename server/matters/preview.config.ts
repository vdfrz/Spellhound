import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({ root: 'server/matters', plugins: [react()], resolve: { alias: { '@': resolve('src') } },
  build: { outDir: resolve('.spellhound/matter-preview'), emptyOutDir: true, rollupOptions: { input: resolve('server/matters/preview.html') } } });
