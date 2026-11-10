import { memo, useEffect, useMemo } from "react";
import { getFilterById } from "../utils/filters";
import { videoTransform } from "../utils/video";
import { useVideoRect } from "../hooks/useVideoRect";
import "./VideoPlayer.css";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  src: string;
  speed: number;
  muted: boolean;
  filterId: string;
  rotation: number;
  straighten: number;
  perspectiveH: number;
  perspectiveV: number;
  /** Show the picture untransformed (crop editing happens in source pixels). */
  neutral?: boolean;
  onTimeUpdate: (time: number) => void;
  onDurationLoaded: (duration: number) => void;
  onPlayPause: (playing: boolean) => void;
  onError?: () => void;
}

function VideoPlayer({
  videoRef,
  src,
  speed,
  muted,
  filterId,
  rotation,
  straighten,
  perspectiveH,
  perspectiveV,
  neutral = false,
  onTimeUpdate,
  onDurationLoaded,
  onPlayPause,
  onError,
}: Props) {
  const filter = useMemo(() => getFilterById(filterId), [filterId]);
  const rect = useVideoRect(videoRef);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, videoRef]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, videoRef]);

  const videoStyle: React.CSSProperties = {
    filter: filter.id !== "mirror" && filter.id !== "upside_down" ? filter.css : "none",
    transform: neutral
      ? "none"
      : videoTransform(
          rotation,
          straighten,
          perspectiveH,
          perspectiveV,
          filter.id,
          rect ? { w: rect.width, h: rect.height } : undefined,
        ),
    // matrix3d is expressed from the element's top-left corner.
    transformOrigin: perspectiveH !== 0 || perspectiveV !== 0 ? "0 0" : undefined,
    transition: "transform 0.1s ease-out",
  };

  return (
    <video
      ref={videoRef}
      className="video-element"
      src={src}
      // Frames are drawn to canvases (filter previews); a cross-origin video
      // without CORS would taint them (the dev page is not on the media's origin).
      crossOrigin="anonymous"
      style={videoStyle}
      onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
      onLoadedMetadata={(e) => onDurationLoaded(e.currentTarget.duration)}
      onPlay={() => onPlayPause(true)}
      onPause={() => onPlayPause(false)}
      onEnded={() => onPlayPause(false)}
      onError={onError}
      onClick={(e) => {
        const v = e.currentTarget;
        if (v.paused || v.ended) {
          void v.play();
        } else {
          v.pause();
        }
      }}
    />
  );
}

export default memo(VideoPlayer);
