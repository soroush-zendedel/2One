import { defineConfig } from 'vite';

export default defineConfig({
  // Change this if the GitHub repository has a different name.
  base: process.env.GITHUB_ACTIONS ? '/2One/' : '/',
});
