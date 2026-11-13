import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { T } from "./i18n";

/** Le traducteur de la vue Image, dans la langue courante de l'éditeur. */
export function useT(): T {
  const { t } = useTranslation();
  return useCallback((key, vars) => String(t(`imageTool.${key}`, vars ?? {})), [t]);
}
