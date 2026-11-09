#!/usr/bin/env node
// Télécharge les binaires ffmpeg/ffprobe (builds statiques GPL) pour une cible Rust et les place
// dans src-tauri/binaries/<nom>-<triple>, où Tauri les embarque (bundle.externalBin).
//
//   node scripts/fetch-ffmpeg.mjs [--target <triple>]    (défaut : la cible hôte de rustc)
//
// Chaque archive est vérifiée contre le SHA256 épinglé dans scripts/ffmpeg-sources.json : une
// archive modifiée ou corrompue fait échouer le script. Rien n'est retéléchargé si les binaires
// de la bonne version sont déjà là.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(readFileSync(join(root, "scripts", "ffmpeg-sources.json"), "utf8"));
const outDir = join(root, "src-tauri", "binaries");

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = /^host: (.+)$/m.exec(out)?.[1];
  if (!host) throw new Error("Impossible de lire la cible hôte de rustc");
  return host;
}

async function download(url, sha256, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  const data = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(data).digest("hex");
  if (got !== sha256) throw new Error(`SHA256 inattendu pour ${url}\n  attendu ${sha256}\n  obtenu  ${got}`);
  writeFileSync(dest, data);
}

function extract(archive, dir) {
  // GNU tar lit les .tar.xz, bsdtar (macOS) lit aussi les .zip.
  execFileSync("tar", ["-xf", archive, "-C", dir], { stdio: "inherit" });
}

function install(from, name, triple) {
  const dest = join(outDir, `${name}-${triple}`);
  copyFileSync(from, dest);
  chmodSync(dest, 0o755);
}

const args = process.argv.slice(2);
const flag = args.indexOf("--target");
const triple = flag >= 0 ? args[flag + 1] : hostTriple();
const target = sources.targets[triple];
if (!target) {
  console.error(
    `Aucun build ffmpeg épinglé pour la cible ${triple} (cibles : ${Object.keys(sources.targets).join(", ")})`,
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const stamp = join(outDir, `.ffmpeg-${triple}.version`);
const wanted = JSON.stringify(target);
if (
  existsSync(join(outDir, `ffmpeg-${triple}`)) &&
  existsSync(join(outDir, `ffprobe-${triple}`)) &&
  existsSync(stamp) &&
  readFileSync(stamp, "utf8") === wanted
) {
  console.log(`ffmpeg ${sources.version} déjà présent pour ${triple}`);
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), "ffmpeg-fetch-"));
try {
  if (target.separate) {
    for (const [name, spec] of Object.entries(target.separate)) {
      const dir = join(tmp, name);
      mkdirSync(dir);
      const archive = join(tmp, `${name}.zip`);
      console.log(`Téléchargement de ${name} pour ${triple}…`);
      await download(spec.archive, spec.sha256, archive);
      extract(archive, dir);
      install(join(dir, spec.member), name, triple);
    }
  } else {
    const archive = join(tmp, "ffmpeg.tar.xz");
    console.log(`Téléchargement de ffmpeg + ffprobe pour ${triple} (archive volumineuse)…`);
    await download(target.archive, target.sha256, archive);
    extract(archive, tmp);
    install(join(tmp, target.ffmpeg), "ffmpeg", triple);
    install(join(tmp, target.ffprobe), "ffprobe", triple);
  }
  writeFileSync(stamp, wanted);
  console.log(`ffmpeg ${sources.version} installé dans ${outDir}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
