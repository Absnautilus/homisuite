import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    react(),
    dts({ tsconfigPath: './tsconfig.json', entryRoot: 'src', rollupTypes: false }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'shifts-module.js',
      cssFileName: 'shifts-module',
    },
    rollupOptions: {
      // @homisuite/ui wasn't external -- bundled in here, this module would
      // get its own separate copy of any context @homisuite/ui exports
      // (createContext() called twice is two distinct context objects),
      // invisible to the single <UndoProvider> (or any future provider)
      // apps/web mounts around the whole app. See the identical, actually
      // triggered bug this fixed in modules/housekeeping/vite.config.ts.
      external: ['react', 'react/jsx-runtime', 'react-dom', '@homisuite/ui'],
    },
  },
})
