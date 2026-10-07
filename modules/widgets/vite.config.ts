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

/**
 * Reown AppKit must exist once on the page. Every copy registers the same
 * custom elements (w3m-modal…) as the bundle loads and the first one wins,
 * so with a second copy (the Tron connector brings its own) the EVM
 * wallet's QR window rendered the other copy's empty state and never showed.
 */
const APPKIT_PACKAGES = [
  '@reown/appkit',
  '@reown/appkit-common',
  '@reown/appkit-controllers',
  '@reown/appkit-pay',
  '@reown/appkit-polyfills',
  '@reown/appkit-scaffold-ui',
  '@reown/appkit-ui',
  '@reown/appkit-utils',
  '@reown/appkit-wallet',
];

export default defineConfig({
  plugins: [react(), copyToExchangePlugin()],
  resolve: {
    dedupe: APPKIT_PACKAGES,
  },
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
