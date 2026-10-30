import { invoke } from "@tauri-apps/api/core";

/**
 * Clés API des moteurs d'assets libres (Pexels, Pixabay, Freesound), fournies par l'utilisateur ;
 * Openverse fonctionne sans clé. Elles sont rangées par le backend dans le trousseau du système
 * (repli : fichier de réglages en 0600 si le trousseau est indisponible).
 */
export interface ApiKeys {
  pexels?: string;
  pixabay?: string;
  freesound?: string;
}

export function loadApiKeys(): Promise<ApiKeys> {
  return invoke("load_api_keys");
}

export function saveApiKeys(keys: ApiKeys): Promise<void> {
  return invoke("save_api_keys", { keys });
}
