import type { CropRect } from "../types";
import { useVideoRect } from "../hooks/useVideoRect";
import { videoTransform } from "../utils/video";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  crop: CropRect;
  /** The video's geometry, so the frame follows its rotation/perspective. */
  geometry?: { rotation: number; straighten: number; perspectiveH: number; perspectiveV: number; filterId: string };
  /** Override of the computed transform (tests). */
  transform?: string;
}

export default function CropFrame({ videoRef, crop, geometry, transform }: Props) {
  const rect = useVideoRect(videoRef);
  if (!rect || !rect.naturalWidth) return null;

  const scale = rect.width / rect.naturalWidth;
  const cssTransform =
    transform ??
    (geometry
      ? videoTransform(
          geometry.rotation,
          geometry.straighten,
          geometry.perspectiveH,
          geometry.perspectiveV,
          geometry.filterId,
          { w: rect.width, h: rect.height },
        )
      : undefined);
  const fromTopLeft = !transform && !!geometry && (geometry.perspectiveH !== 0 || geometry.perspectiveV !== 0);

  return (
    <div
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        transform: cssTransform,
        transformOrigin: fromTopLeft ? "0 0" : undefined,
        transition: "transform 0.1s ease-out",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: crop.x * scale,
          top: crop.y * scale,
          width: crop.w * scale,
          height: crop.h * scale,
          border: "2px solid #e53e3e",
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
