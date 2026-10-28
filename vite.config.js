import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/Didi/' : '/',
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg'],
  },
  build: {
    rollupOptions: {
      input: {
        home: page('./index.html'),
        about: page('./about.html'),
        persianHome: page('./fa/index.html'),
        persianAbout: page('./fa/about.html'),
      },
    },
  },
});
