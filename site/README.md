# LightEditorVidz : site

Site de présentation de LightEditorVidz (Astro, export statique), publié par GitHub Pages sur
<https://light-editor-vidz.github.io/light-editor-vidz/>. Il vit dans ce dépôt, dans `site/`.

```
cd site
npm install
npm run dev      # http://localhost:4321/light-editor-vidz/
npm test         # build + vérifications (pages, liens, FR/EN, scripts d'installation)
```

- Contenu et textes FR/EN : `src/data/content.ts` — la présentation du logiciel (`editor`) et cinq guides détaillés (`tools` : montage de projet, vues Audio, Image et Vidéo, sous-titres), chacun avec fonctionnement pas à pas, fonctionnalités, raccourcis, exemples et notes ; `src/data/apps.ts` (commandes d'installation / désinstallation) ; `src/data/ui.ts` (interface). Pages : `/` accueil, `/guide/` guide général (présentation, installation, désinstallation), `/guide/<guide>/` un guide détaillé, `/install/`.
- `install.sh` et `uninstall.sh` de la racine du dépôt sont copiés dans `public/` avant chaque `dev` et `build` (`scripts/prepare.mjs`) : le site les sert lui-même, et les commandes affichées pointent vers lui.
- Logo : `public/logos/` (SVG + PNG 256/512/1024). Captures d'écran (thème sombre) : `public/screenshots/{guide}/{nom}-{fr|en}.webp`, dimensions dans `src/data/shots.json`.
- Déploiement : `.github/workflows/site.yml`, à chaque push sur `main` qui touche `site/`, `install.sh` ou `uninstall.sh`.
- Si un domaine personnalisé est configuré, retirer `base` de `astro.config.mjs` et `BASE` de `scripts/check.mjs`.
