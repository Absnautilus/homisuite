import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    react(),
    dts({
      tsconfigPath: './tsconfig.json',
      entryRoot: 'src',
      rollupTypes: false,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'housekeeping-module.js',
      cssFileName: 'housekeeping-module',
    },
    rollupOptions: {
      // @homisuite/ui wasn't external -- its own build inlined a second,
      // separate copy of UndoContext (createContext() called twice ends up
      // as two distinct context objects) instead of sharing apps/web's
      // single instance. useUndo() inside this module's own copy could
      // never see the <UndoProvider> apps/web mounts around the whole app,
      // throwing "useUndo must be used within UndoProvider" on every
      // mount of ItemsPage/RoomsPage, crashing the entire app with no
      // error boundary to catch it (see ErrorBoundary.tsx) -- not a stale
      // deploy, a real bug on every single load.
      external: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-router-dom',
        '@supabase/supabase-js',
        '@homisuite/ui',
      ],
    },
  },
})
