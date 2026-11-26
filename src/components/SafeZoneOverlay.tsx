import type { SafeZone } from "../lib/platforms";
import "./SafeZoneOverlay.css";

const percent = (fraction: number) => `${+(fraction * 100).toFixed(2)}%`;

/** Les bandes que l'application de destination couvre, posées sur l'image. À placer dans un parent
 * positionné aux dimensions de l'image ; les clics le traversent. */
export default function SafeZoneOverlay({ zone }: { zone: SafeZone }) {
  const [top, bottom, left, right] = [zone.top, zone.bottom, zone.left, zone.right].map(percent);
  return (
    <div className="safe-zone" aria-hidden="true">
      <div className="safe-zone-band" style={{ top: 0, left: 0, right: 0, height: top }} />
      <div className="safe-zone-band" style={{ bottom: 0, left: 0, right: 0, height: bottom }} />
      <div className="safe-zone-band" style={{ top, bottom, left: 0, width: left }} />
      <div className="safe-zone-band" style={{ top, bottom, right: 0, width: right }} />
      <div className="safe-zone-frame" style={{ top, bottom, left, right }} />
    </div>
  );
}
