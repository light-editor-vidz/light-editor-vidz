import { useEffect, useRef } from "react";
import type { CropRect } from "../types";
import type { ReframeMode } from "../utils/presets";
import { fitBox } from "../utils/reframePreview";
import type { SafeZone } from "../../../lib/platforms";
import SafeZoneOverlay from "../../SafeZoneOverlay";

/** Taille de dessin de la vignette (9:16). */
const WIDTH = 270;
const HEIGHT = 480;

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  zone: SafeZone;
  /** La partie gardée de l'image, en pixels de la source (avant rotation). */
  crop: CropRect | null;
  rotation: number;
  mode: ReframeMode;
  label: string;
}

/** Ce que donnera l'export recadré en 9:16, avec les zones couvertes : pour une image qui n'est
 * pas encore verticale. Redressement, perspective et filtres de couleur n'y figurent pas. */
export default function ReframedSafeZone({ videoRef, zone, crop, rotation, mode, label }: Props) {
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const pictureRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const quarter = ((Math.round(rotation / 90) % 4) + 4) % 4;
    let request = 0;
    let drawn = "";
    const draw = () => {
      request = requestAnimationFrame(draw);
      const video = videoRef.current;
      if (!video || !video.videoWidth || video.readyState < 2) return;
      const frame = `${video.currentSrc}@${video.currentTime}`;
      if (frame === drawn) return;
      const part = crop ?? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
      const turned = quarter % 2 === 1;
      const picture = turned ? { w: part.h, h: part.w } : { w: part.w, h: part.h };
      const paint = (canvas: HTMLCanvasElement | null, fit: "contain" | "cover") => {
        const context = canvas?.getContext("2d");
        if (!context) return false;
        const box = fitBox(picture, { w: WIDTH, h: HEIGHT }, fit);
        context.clearRect(0, 0, WIDTH, HEIGHT);
        context.save();
        context.translate(box.x + box.w / 2, box.y + box.h / 2);
        context.rotate((quarter * Math.PI) / 2);
        const [w, h] = turned ? [box.h, box.w] : [box.w, box.h];
        context.drawImage(video, part.x, part.y, part.w, part.h, -w / 2, -h / 2, w, h);
        context.restore();
        return true;
      };
      const foreground = paint(pictureRef.current, mode === "crop" ? "cover" : "contain");
      if (mode === "blur") paint(backgroundRef.current, "cover");
      if (foreground) drawn = frame;
    };
    request = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(request);
  }, [videoRef, crop, rotation, mode]);

  return (
    <figure className="safe-zone-inset">
      <div className="safe-zone-inset-frame">
        {mode === "blur" && <canvas ref={backgroundRef} className="blurred" width={WIDTH} height={HEIGHT} />}
        <canvas ref={pictureRef} width={WIDTH} height={HEIGHT} />
        <SafeZoneOverlay zone={zone} />
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
