import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import type { ChromaKey } from "../../bindings/ChromaKey";
import type { VideoCrop } from "../../bindings/VideoCrop";
import { createKeyer, keyPixels } from "../../lib/chroma";
import { clampCrop, COLOR_FILTERS, cssFilterFor, FULL_CROP } from "../../lib/videoFx";

/** Plus grand côté de l'image traitée dans l'aperçu : au-delà, le détourage image par image ne
 * suit plus la lecture. L'export traite la pleine résolution. */
const MAX_PREVIEW_SIDE = 960;

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  chromaKey: ChromaKey;
  crop: VideoCrop | null;
  colorFilter: string | null;
  style: CSSProperties;
  /** La webview refuse de lire les pixels de la vidéo. */
  onUnavailable: () => void;
}

/** La vidéo détourée, redessinée à chaque nouvelle image de l'élément `<video>` (masqué). */
export default function KeyedVideoCanvas({ videoRef, chromaKey, crop, colorFilter, style, onUnavailable }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const filtered = !!COLOR_FILTERS.find((f) => f.id === colorFilter)?.ffmpeg;
    const keyer = createKeyer(chromaKey, !filtered);
    let request = 0;
    let drawn = "";
    const draw = () => {
      request = requestAnimationFrame(draw);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth || video.readyState < 2) return;
      const frame = `${video.currentSrc}@${video.currentTime}`;
      if (frame === drawn) return;
      const area = clampCrop(crop ?? FULL_CROP);
      const sw = video.videoWidth * area.w;
      const sh = video.videoHeight * area.h;
      const scale = Math.min(1, MAX_PREVIEW_SIDE / Math.max(sw, sh));
      const width = Math.max(1, Math.round(sw * scale));
      const height = Math.max(1, Math.round(sh * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      try {
        context.clearRect(0, 0, width, height);
        context.drawImage(video, video.videoWidth * area.x, video.videoHeight * area.y, sw, sh, 0, 0, width, height);
        if (keyer) {
          const pixels = context.getImageData(0, 0, width, height);
          keyPixels(pixels.data, keyer);
          context.putImageData(pixels, 0, 0);
        }
        if (colorFilter === "vignette") drawVignette(context, width, height);
        drawn = frame;
      } catch {
        cancelAnimationFrame(request);
        onUnavailable();
      }
    };
    request = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(request);
  }, [videoRef, chromaKey, crop, colorFilter, onUnavailable]);

  return <canvas ref={canvasRef} className="keyed-video" style={{ ...style, filter: cssFilterFor(colorFilter) }} />;
}

/** `VIGNETTE_GRADIENT` dessiné sur les seuls pixels visibles : posé par-dessus, il assombrirait
 * aussi ce que le détourage laisse voir. */
function drawVignette(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.globalCompositeOperation = "source-atop";
  context.translate(width / 2, height / 2);
  context.scale(width / 2, height / 2);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1.35);
  gradient.addColorStop(0.55 / 1.35, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,0.75)");
  context.fillStyle = gradient;
  context.fillRect(-1.5, -1.5, 3, 3);
  context.restore();
}
