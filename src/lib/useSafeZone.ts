import { useState } from "react";
import { SAFE_ZONE_PLATFORMS, type SafeZonePlatform } from "./platforms";

const KEY = "lev_safe_zone";

function load(): SafeZonePlatform | null {
  try {
    const saved = localStorage.getItem(KEY);
    return SAFE_ZONE_PLATFORMS.find((p) => p.id === saved)?.id ?? null;
  } catch {
    return null;
  }
}

/** La plateforme dont l'aperçu montre les zones couvertes, retenue d'une session à l'autre. C'est
 * un réglage d'affichage : il n'entre ni dans le projet ni dans l'export. */
export function useSafeZone(): [SafeZonePlatform | null, (value: string) => void] {
  const [zone, setZone] = useState(load);
  const choose = (value: string) => {
    const next = SAFE_ZONE_PLATFORMS.find((p) => p.id === value)?.id ?? null;
    setZone(next);
    try {
      localStorage.setItem(KEY, next ?? "");
    } catch {
      /* non retenu */
    }
  };
  return [zone, choose];
}
