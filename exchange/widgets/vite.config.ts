import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'global': 'window',
  },
  build: {
    outDir: path.resolve(__dirname, '../../frontend/exchange'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/index.tsx'),
      name: 'CoinmanExchangeLiFi',
      fileName: () => 'exchange-lifi.bundle.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'exchange-lifi.bundle.css';
          }
          return assetInfo.name || 'asset-[hash][extname]';
        },
      },
    },
  },
});
