import { readMediaFile } from "./commands";
import { mediaMimeType } from "./assetUrl";

/**
 * Cache refcounté d'URLs `blob:` pour les sources audio/vidéo (voir `read_media_file` côté Rust
 * pour le pourquoi du chargement en octets bruts). Sans cache, chaque élément vidéo relit tout le
 * fichier et crée son propre blob : dupliquer ou splitter un clip de 200 Mo doublerait la
 * mémoire et le temps de chargement.
 *
 * Quand le dernier consommateur relâche une source, son blob n'est pas révoqué tout de suite :
 * il reste « inactif » dans un cache LRU borné en octets. Une vidéo dont la tête de lecture sort
 * puis rentre n'est donc pas relue en entier depuis le disque à chaque apparition (saccade, image
 * noire au début du clip). `preloadMedia` permet de charger à l'avance les clips à venir.
 */

interface Entry {
  promise: Promise<string>;
  url: string | null;
  refs: number;
  bytes: number;
}

/** Mémoire maximale (octets) des blobs inactifs conservés. */
export const IDLE_BUDGET_BYTES = 384 * 1024 * 1024;

const entries = new Map<string, Entry>();
/** Entrées chargées et sans consommateur, de la moins récemment utilisée à la plus récente. */
const idle = new Map<string, Entry>();

function discard(key: string, entry: Entry) {
  if (entry.url) URL.revokeObjectURL(entry.url);
  entry.url = null;
  if (entries.get(key) === entry) entries.delete(key);
  idle.delete(key);
}

function evictIdle() {
  let total = 0;
  idle.forEach((entry) => (total += entry.bytes));
  for (const [key, entry] of idle) {
    if (total <= IDLE_BUDGET_BYTES) break;
    total -= entry.bytes;
    discard(key, entry);
  }
}

function releaseEntry(key: string, entry: Entry) {
  entry.refs -= 1;
  if (entry.refs > 0) return;
  if (!entry.url) {
    // Chargement encore en cours : rien à conserver, l'URL sera révoquée à son arrivée.
    entries.delete(key);
    return;
  }
  idle.set(key, entry);
  evictIdle();
}

/**
 * Retourne (ou charge) l'URL blob de la source, et une fonction `release` à appeler au
 * démontage. `release` est idempotente ; l'URL est conservée (cache inactif) quand le dernier
 * consommateur la relâche, et révoquée si ce relâchement survient avant la fin du chargement.
 */
export function acquireMediaObjectUrl(
  projectDir: string,
  relativeSrc: string,
): { promise: Promise<string>; release: () => void } {
  const key = `${projectDir}\n${relativeSrc}`;
  let entry = entries.get(key);
  if (!entry) {
    const created: Entry = { promise: Promise.resolve(""), url: null, refs: 0, bytes: 0 };
    created.promise = readMediaFile(projectDir, relativeSrc).then((bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: mediaMimeType(relativeSrc) }));
      if (entries.get(key) !== created || created.refs <= 0) {
        // Tous les consommateurs ont disparu pendant le chargement : rien ne référencera
        // cette URL, on la révoque immédiatement.
        URL.revokeObjectURL(url);
      } else {
        created.url = url;
        created.bytes = bytes.byteLength;
      }
      return url;
    });
    // Un échec ne doit pas rester en cache (le fichier peut apparaître/être réparé ensuite).
    created.promise.catch(() => {
      if (entries.get(key) === created) entries.delete(key);
    });
    entries.set(key, created);
    entry = created;
  }
  // Un blob inactif qui reprend du service n'est plus candidat à l'éviction.
  idle.delete(key);
  entry.refs += 1;
  let released = false;
  const acquired = entry;
  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      // Ne décrémente que si l'entrée du cache est toujours celle qu'on a acquise (elle peut
      // avoir été remplacée après un échec de chargement).
      if (entries.get(key) === acquired) releaseEntry(key, acquired);
    },
  };
}

/** Charge une source à l'avance (clips de la scène suivante) : elle reste dans le cache inactif
 * jusqu'à ce qu'un élément la demande. Les erreurs sont ignorées (le vrai consommateur les
 * traitera). */
export function preloadMedia(projectDir: string, relativeSrc: string): void {
  const { promise, release } = acquireMediaObjectUrl(projectDir, relativeSrc);
  promise.then(release, release);
}

/** Révoque tous les blobs inactifs (changement de projet, fermeture de l'éditeur). */
export function dropIdleMedia(): void {
  for (const [key, entry] of Array.from(idle)) discard(key, entry);
}

/** Nombre d'entrées vivantes — exposé pour les tests uniquement. */
export function cacheSizeForTests(): number {
  return entries.size;
}

/** Nombre d'entrées inactives — exposé pour les tests uniquement. */
export function idleCountForTests(): number {
  return idle.size;
}
