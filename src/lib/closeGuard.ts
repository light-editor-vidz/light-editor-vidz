import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasBeforeExitTasks, runBeforeExit } from "./lifecycle";

/**
 * Intercepte la fermeture de la fenêtre : si des travaux sont en attente (modifications non
 * enregistrées), ils sont terminés avant de fermer ; s'ils échouent, la fenêtre reste ouverte
 * (l'éditeur affiche l'erreur) plutôt que de perdre le travail. Retourne la fonction de retrait.
 */
export async function installCloseGuard(): Promise<() => void> {
  try {
    const appWindow = getCurrentWindow();
    return await appWindow.onCloseRequested(async (event) => {
      if (!hasBeforeExitTasks()) return;
      event.preventDefault();
      if (await runBeforeExit()) await appWindow.destroy();
    });
  } catch {
    // Hors de Tauri (tests, navigateur) : pas de fenêtre à garder.
    return () => {};
  }
}
