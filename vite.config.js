import { defineConfig } from 'vite';

// Cross-origin isolation lets the speech engine use several CPU threads
// (much faster). The same headers are set for the live site in public/_headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  server: { port: 5184, strictPort: true, headers: isolation },
  preview: { port: 5185, strictPort: true, headers: isolation },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    // Two pages: the app, and the free-and-open-source page at /pricing.
    rollupOptions: { input: { main: 'index.html', pricing: 'pricing.html', credits: 'credits.html' } },
  },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
