import i18n from "i18next";

/**
 * Les commandes Tauri renvoient des messages d'erreur en anglais. Les erreurs connues sont
 * traduites ici (préfixe du message → clé `errors.*`, le reste du message devient `{{detail}}`) ;
 * toute autre erreur est affichée telle quelle.
 */
const KNOWN_ERRORS: [prefix: string, key: string][] = [
  ["A project already exists at this location", "errors.projectExists"],
  ["Failed to read project", "errors.readProject"],
  ["Invalid project", "errors.invalidProject"],
  ["This folder is not an open project", "errors.notOpenProject"],
  ["Unsupported ", "errors.unsupportedFile"],
  ["Failed to launch ffmpeg", "errors.ffmpegMissing"],
  ["The project has no scenes to export", "errors.noScenes"],
  ["An export is already running", "errors.exportRunning"],
  ["File too large", "errors.fileTooLarge"],
  ["Only https downloads are allowed", "errors.httpsOnly"],
  ["Download failed", "errors.downloadFailed"],
  ["Failed to write the exported video", "errors.writeExport"],
  ["Failed to copy file", "errors.copyFile"],
];

/** Erreur structurée renvoyée par les commandes Tauri (`commands/error.rs`). */
interface CommandError {
  code: string;
  detail: string;
  message: string;
}

function isCommandError(error: unknown): error is CommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as CommandError).code === "string" &&
    typeof (error as CommandError).message === "string"
  );
}

/** `export_cancelled` → `errors.exportCancelled`. */
const keyForCode = (code: string) => `errors.${code.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`;

/** Vrai si l'erreur signale un export annulé par l'utilisateur. */
export function isExportCancelled(error: unknown): boolean {
  return isCommandError(error) ? error.code === "export_cancelled" : String(error).includes("export-cancelled");
}

/** Message d'erreur lisible, traduit d'après le code de l'erreur (ou, pour une simple chaîne, son préfixe). */
export function describeError(error: unknown): string {
  if (isCommandError(error)) {
    if (error.code === "unknown") return error.message;
    return i18n.t(keyForCode(error.code), { detail: error.detail, defaultValue: error.message });
  }
  const raw = error instanceof Error ? error.message : String(error);
  for (const [prefix, key] of KNOWN_ERRORS) {
    if (raw.startsWith(prefix)) {
      const detail = raw.slice(prefix.length).replace(/^[:\s]+/, "");
      return i18n.t(key, { detail, defaultValue: raw });
    }
  }
  return raw;
}
