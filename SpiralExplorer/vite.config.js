import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages hosts project sites below /<repository>/.
  // Local development remains at http://localhost:5173/.
  base: process.env.VITE_BASE_PATH || '/',
});
