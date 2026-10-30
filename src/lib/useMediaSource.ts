import { useCallback, useEffect, useState } from "react";
import { streamUrl } from "./assetUrl";
import { acquireMediaObjectUrl } from "./mediaCache";

/**
 * Source d'un `<video>`/`<audio>` du projet. Par défaut, le média est lu en flux par le protocole
 * `lvmedia://` (requêtes `Range` : seuls les octets utiles sont lus, démarrage immédiat). Si la
 * webview refuse ce protocole (`onError`), on bascule sur l'URL `blob:` construite depuis les
 * octets bruts (`read_media_file`, partagée via `mediaCache`) — l'ancien comportement.
 */
export function useMediaSource(projectDir: string, relativeSrc: string) {
  // Les états sont rattachés à la source qui les a produits : changer de source repart du flux
  // sans réinitialisation manuelle.
  const key = `${projectDir}\n${relativeSrc}`;
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);
  const [blob, setBlob] = useState<{ key: string; url?: string; error?: string } | null>(null);
  const useBlob = fallbackFor === key;

  useEffect(() => {
    if (!useBlob) return;
    let cancelled = false;
    const { promise, release } = acquireMediaObjectUrl(projectDir, relativeSrc);
    promise
      .then((url) => {
        if (!cancelled) setBlob({ key, url });
      })
      .catch((e) => {
        if (!cancelled) setBlob({ key, error: String(e) });
      });
    return () => {
      cancelled = true;
      release();
    };
  }, [useBlob, projectDir, relativeSrc, key]);

  /** À appeler quand le lecteur signale une erreur : passe au repli blob (une seule fois). */
  const fallBack = useCallback(() => setFallbackFor(key), [key]);

  const current = blob?.key === key ? blob : null;
  const src = useBlob ? (current?.url ?? null) : streamUrl(projectDir, relativeSrc);
  return { src, usingBlob: useBlob, blobError: current?.error ?? null, fallBack };
}
