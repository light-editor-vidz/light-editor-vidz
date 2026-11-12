import i18n from "i18next";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";

/**
 * Les travaux en cours que quitter l'application interromprait : un export (audio, image, projet),
 * une génération de sous-titres, et la file des exports vidéo, qui continue sans son onglet.
 * Chaque vue déclare le sien le temps qu'il dure ; avant de quitter, l'utilisateur confirme.
 */
const running = new Map<symbol, string>();

/** Déclare un travail (`labelKey` : sa description traduite) ; retourne la fonction qui le retire. */
export function markBusy(labelKey: string): () => void {
  const id = Symbol(labelKey);
  running.set(id, labelKey);
  return () => running.delete(id);
}

/** Les descriptions (clés de traduction) des travaux en cours, sans doublon. */
export async function busyWork(): Promise<string[]> {
  const keys = new Set(running.values());
  try {
    const jobs = await invoke<{ status: string }[]>("video_queue_list");
    if (jobs.some((job) => job.status === "queued" || job.status === "running")) keys.add("quit.videoExports");
  } catch {
    // Hors de Tauri (tests) : pas de file.
  }
  return [...keys];
}

/** Vrai si l'on peut quitter : rien n'est en cours, ou l'utilisateur accepte de l'interrompre. */
export async function confirmQuitWithBusyWork(): Promise<boolean> {
  const keys = await busyWork();
  if (keys.length === 0) return true;
  const list = keys.map((key) => `• ${i18n.t(key)}`).join("\n");
  try {
    return await ask(i18n.t("quit.busy", { list }), {
      title: i18n.t("quit.title"),
      kind: "warning",
      okLabel: i18n.t("quit.confirm"),
      cancelLabel: i18n.t("quit.cancel"),
    });
  } catch {
    return true;
  }
}
