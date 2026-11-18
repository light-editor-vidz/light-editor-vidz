/**
 * Travaux à terminer avant que l'application ne s'arrête (fermeture de la fenêtre, relance après
 * une mise à jour) : ici, enregistrer les modifications que la sauvegarde automatique n'a pas
 * encore écrites. Les composants enregistrent leur travail ; l'appelant l'attend.
 */
type Task = () => Promise<unknown>;

const tasks = new Set<Task>();

/** Enregistre un travail à terminer avant l'arrêt ; retourne la fonction qui le retire. */
export function registerBeforeExit(task: Task): () => void {
  tasks.add(task);
  return () => tasks.delete(task);
}

/** Vrai si au moins un travail est enregistré. */
export function hasBeforeExitTasks(): boolean {
  return tasks.size > 0;
}

/** Attend tous les travaux enregistrés. Retourne `false` si l'un d'eux a échoué : l'appelant
 * doit alors renoncer à arrêter l'application (des données seraient perdues). */
export async function runBeforeExit(): Promise<boolean> {
  // Une tâche après l'autre : plusieurs onglets avec des modifications poseraient sinon leurs
  // questions « Quitter ? » toutes en même temps. La première réponse négative arrête la suite.
  for (const task of Array.from(tasks)) {
    try {
      if ((await task()) === false) return false;
    } catch {
      return false;
    }
  }
  return true;
}
