import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function copyToExchangePlugin() {
  return {
    name: 'copy-to-exchange',
    closeBundle() {
      const srcDir = path.resolve(__dirname, '../../frontend/modules');
      const destDir = path.resolve(__dirname, '../../frontend/exchange');
      try {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        if (fs.existsSync(path.join(srcDir, 'modules.bundle.js'))) {
          fs.copyFileSync(
            path.join(srcDir, 'modules.bundle.js'),
            path.join(destDir, 'exchange.bundle.js')
          );
        }
        if (fs.existsSync(path.join(srcDir, 'modules.bundle.css'))) {
          fs.copyFileSync(
            path.join(srcDir, 'modules.bundle.css'),
            path.join(destDir, 'exchange.bundle.css')
          );
        }
        console.log('[Vite] Synced bundle to frontend/exchange for backward compatibility.');
      } catch (e) {
        console.warn('[Vite] Failed to sync to exchange:', e);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyToExchangePlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'global': 'window',
  },
  build: {
    outDir: path.resolve(__dirname, '../../frontend/modules'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/index.tsx'),
      name: 'CoinmanModules',
      fileName: () => 'modules.bundle.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'modules.bundle.css';
          }
          return assetInfo.name || 'asset-[hash][extname]';
        },
      },
    },
  },
});
