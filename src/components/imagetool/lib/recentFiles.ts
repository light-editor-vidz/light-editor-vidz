const KEY = "lciz-recent";
const MAX = 10;

function write(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Stockage indisponible (mode privé, quota) : la liste des récents est facultative.
  }
}

export function getRecentFiles(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function addRecentFile(path: string): void {
  write([path, ...getRecentFiles().filter((p) => p !== path)]);
}

/** Retire un fichier devenu introuvable (déplacé, supprimé) de la liste. */
export function removeRecentFile(path: string): void {
  write(getRecentFiles().filter((p) => p !== path));
}

export function clearRecentFiles(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // voir `write`
  }
}
