import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import { checkDelivery, type CheckItem, type PlatformId, type PlatformSpec } from "./platforms";

/** Ce que Rust relit dans le fichier exporté (`export::inspect`). */
export interface DeliveryReport {
  duration: number;
  size_bytes: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  video_codec: string | null;
  hdr: boolean;
  has_audio: boolean;
  loudness: number | null;
  true_peak: number | null;
}

export async function inspectDelivery(path: string, platform: PlatformSpec): Promise<CheckItem[]> {
  const report = await invoke<DeliveryReport>("inspect_export", { path });
  const ratio = report.width && report.height ? report.width / report.height : undefined;
  return checkDelivery(platform, { ...report, ratio });
}

export const describeCheck = (item: CheckItem, t: TFunction): string =>
  t(`delivery.item.${item.id}`, { value: item.value, expected: item.expected });

/** La destination choisie pour chaque fichier mis en file : la file la contrôle une fois écrit. */
export const queuedDestinations = new Map<string, PlatformId>();
