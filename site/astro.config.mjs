import { defineConfig } from 'astro/config';

// GitHub Pages sert le dépôt light-editor-vidz sous /light-editor-vidz.
export default defineConfig({
  site: 'https://light-editor-vidz.github.io',
  base: '/light-editor-vidz',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
