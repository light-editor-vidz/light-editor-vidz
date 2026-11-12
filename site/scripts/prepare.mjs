// Copie install.sh et uninstall.sh de la racine du dépôt dans public/ : le site les sert lui-même,
// les commandes affichées n'ont donc pas à pointer vers un autre dépôt. Lancé avant `dev` et `build`.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
mkdirSync('public', { recursive: true });
for (const file of ['install.sh', 'uninstall.sh']) {
  const from = resolve(root, file);
  if (!existsSync(from)) throw new Error(`${from} introuvable`);
  copyFileSync(from, `public/${file}`);
}
console.log('install.sh et uninstall.sh copiés dans public/');
