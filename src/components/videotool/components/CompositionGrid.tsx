import { useVideoRect } from "../hooks/useVideoRect";
import "./CompositionGrid.css";

interface Props {
  visible: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

const noVideo = { current: null };

export default function CompositionGrid({ visible, videoRef }: Props) {
  const rect = useVideoRect(videoRef ?? noVideo);
  if (!visible) return null;

  // Pinned to the picture when its position is known, so the thirds fall on the
  // image and not on the black bars around it.
  const style = rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: "auto", bottom: "auto" }
    : undefined;

  return (
    <div className="composition-grid" style={style}>
      <div className="grid-line grid-v1" />
      <div className="grid-line grid-v2" />
      <div className="grid-line grid-h1" />
      <div className="grid-line grid-h2" />
    </div>
  );
}
