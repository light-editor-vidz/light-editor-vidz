# LightEditorVidz : site

Site de présentation de LightEditorVidz (Astro, export statique), publié par GitHub Pages sur
<https://light-editor-vidz.github.io/light-editor-vidz/>. Il vit dans ce dépôt, dans `site/`.

```
cd site
npm install
npm run dev      # http://localhost:4321/light-editor-vidz/
npm test         # build + vérifications (pages, liens, FR/EN, scripts d'installation)
```

- Contenu et textes FR/EN : `src/data/content.ts` (présentation, fonctionnement pas à pas, fonctionnalités, exemples, notes), `src/data/apps.ts` (commandes d'installation / désinstallation), `src/data/ui.ts` (interface).
- `install.sh` et `uninstall.sh` de la racine du dépôt sont copiés dans `public/` avant chaque `dev` et `build` (`scripts/prepare.mjs`) : le site les sert lui-même, et les commandes affichées pointent vers lui.
- Logo : `public/logos/` (SVG + PNG 256/512/1024). Captures d'écran (thème sombre) : `public/screenshots/editor-vidz/{nom}-{fr|en}.webp`, dimensions dans `src/data/shots.json`.
- Déploiement : `.github/workflows/site.yml`, à chaque push sur `main` qui touche `site/`, `install.sh` ou `uninstall.sh`.
- Si un domaine personnalisé est configuré, retirer `base` de `astro.config.mjs` et `BASE` de `scripts/check.mjs`.
