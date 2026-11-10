import { useVideoRect } from "../hooks/useVideoRect";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  visible: boolean;
}

// CSS filters cannot darken corners, so the vignette filter is previewed as a
// radial gradient laid over the picture (the export uses ffmpeg's `vignette`).
export default function VignetteOverlay({ videoRef, visible }: Props) {
  const rect = useVideoRect(videoRef);
  if (!visible || !rect) return null;
  return (
    <div
      className="vignette-overlay"
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: "none",
        zIndex: 3,
        background: "radial-gradient(ellipse closest-side at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.75) 135%)",
      }}
    />
  );
}
