import { useVideoRect } from "../hooks/useVideoRect";
import type { CropRect } from "../types";
import type { ReframeMode } from "../utils/presets";
import { isVertical916, type SafeZone } from "../../../lib/platforms";
import SafeZoneOverlay from "../../SafeZoneOverlay";
import ReframedSafeZone from "./ReframedSafeZone";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  zone: SafeZone;
  crop: CropRect | null;
  rotation: number;
  /** Le mode de recadrage retenu par la fenêtre d'export. */
  mode: ReframeMode;
  /** La légende de la vignette montrée quand l'image n'est pas déjà en 9:16. */
  label: string;
}

/** Les zones couvertes : sur la partie de l'image qui sera exportée quand elle est déjà en 9:16,
 * sinon sur une vignette du résultat recadré. */
export default function VideoSafeZone({ videoRef, zone, crop, rotation, mode, label }: Props) {
  const rect = useVideoRect(videoRef);
  if (!rect || !rect.naturalWidth) return null;
  const picture = crop ?? { x: 0, y: 0, w: rect.naturalWidth, h: rect.naturalHeight };
  // Pivotée, l'image à l'écran ne correspond plus à la source : la vignette la reconstitue.
  if (rotation % 360 !== 0 || !isVertical916(picture.w, picture.h)) {
    return (
      <ReframedSafeZone videoRef={videoRef} zone={zone} crop={crop} rotation={rotation} mode={mode} label={label} />
    );
  }
  const scale = rect.width / rect.naturalWidth;
  return (
    <div
      style={{
        position: "absolute",
        left: rect.left + picture.x * scale,
        top: rect.top + picture.y * scale,
        width: picture.w * scale,
        height: picture.h * scale,
        pointerEvents: "none",
      }}
    >
      <SafeZoneOverlay zone={zone} />
    </div>
  );
}
