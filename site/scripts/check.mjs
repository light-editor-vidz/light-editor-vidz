// Vérifie le site construit (dist/) : pages présentes, liens internes valides, FR/EN complets,
// scripts d'installation servis, plus aucune trace des anciennes applications.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE = '/light-editor-vidz';
const dist = 'dist';
const errors = [];
const fail = (m) => errors.push(m);

const tools = ['montage', 'audio', 'image', 'video', 'subtitles'];
const pages = ['index.html', '404.html', 'guide/index.html', 'install/index.html', ...tools.map((t) => `guide/${t}/index.html`)];
for (const p of pages) if (!existsSync(join(dist, p))) fail(`page manquante : ${p}`);

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk(dist).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(f, 'utf8');
  if (/scrap|LightCut|LightGen|light app suite/i.test(html)) fail(`${f} : mention d'une ancienne application`);
  if (/github(?!\.io)/i.test(html)) fail(`${f} : référence à GitHub`);
  const fr = (html.match(/lang="fr"/g) ?? []).length - 1;
  const en = (html.match(/lang="en"/g) ?? []).length;
  if (fr !== en) fail(`${f} : ${fr} textes FR pour ${en} textes EN`);
  for (const [, href] of html.matchAll(/(?:href|src)="(\/light-editor-vidz\/[^"#?]*)/g)) {
    const rel = href.slice(BASE.length);
    const ok = existsSync(join(dist, rel)) || existsSync(join(dist, rel, 'index.html'));
    if (!ok) fail(`${f} : lien cassé ${href}`);
  }
}

// Le guide général : présentation, installation, désinstallation, et un lien vers chaque guide.
const hub = readFileSync(join(dist, 'guide/index.html'), 'utf8');
for (const t of ['overview', 'install', 'uninstall']) {
  if (!hub.includes(`id="panel-${t}"`)) fail(`guide : onglet ${t} manquant`);
}
if (!hub.includes(`${BASE}/install.sh | bash`)) fail("guide : commande d'installation absente");
for (const t of tools) if (!hub.includes(`href="${BASE}/guide/${t}/"`)) fail(`guide : lien vers ${t} absent`);

// Chaque guide détaillé : ses quatre onglets, des captures, de vrais contenus.
for (const t of tools) {
  const html = readFileSync(join(dist, `guide/${t}/index.html`), 'utf8');
  for (const tab of ['overview', 'how', 'features', 'examples']) {
    if (!html.includes(`id="panel-${tab}"`)) fail(`${t} : onglet ${tab} manquant`);
  }
  const imgs = [...html.matchAll(/src="(\/light-editor-vidz\/screenshots\/[^"]+)"/g)].length;
  if (imgs < 4) fail(`${t} : ${imgs} captures seulement (deux langues par capture)`);
  const steps = (html.match(/class="step/g) ?? []).length;
  if (steps < 3) fail(`${t} : ${steps} étapes seulement`);
  if ((html.match(/class="ex"/g) ?? []).length < 3) fail(`${t} : moins de 3 exemples`);
}
for (const f of ['install.sh', 'uninstall.sh']) {
  if (!existsSync(join(dist, f))) fail(`${f} absent du site`);
  else if (!readFileSync(join(dist, f), 'utf8').startsWith('#!')) fail(`${f} : ce n'est pas un script`);
}

// Une capture FR identique à sa version EN serait une capture non traduite.
const shots = join('public', 'screenshots');
for (const app of readdirSync(shots)) {
  for (const f of readdirSync(join(shots, app)).filter((f) => f.endsWith('-fr.webp'))) {
    const fr = readFileSync(join(shots, app, f));
    const en = readFileSync(join(shots, app, f.replace('-fr.webp', '-en.webp')));
    if (fr.equals(en)) fail(`capture identique en FR et EN : ${app}/${f}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`ok : ${pages.length} pages vérifiées`);
