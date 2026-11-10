import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

export interface VideoRect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Intrinsic size of the picture, in source pixels. */
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Where the <video> sits inside its positioned parent, from layout metrics
 * (offsetLeft/offsetWidth…) rather than getBoundingClientRect. The latter
 * returns the bounding box of the *transformed* element, so with a rotation or
 * perspective applied every overlay computed from it ends up misplaced.
 *
 * Re-measures on metadata load, window resize and any size change of the video
 * or its parent (e.g. opening a side panel shrinks the player without a
 * window resize).
 */
export function useVideoRect(videoRef: RefObject<HTMLVideoElement | null>): VideoRect | null {
  const [rect, setRect] = useState<VideoRect | null>(null);

  const measure = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const next = {
      left: video.offsetLeft,
      top: video.offsetTop,
      width: video.offsetWidth,
      height: video.offsetHeight,
      naturalWidth: video.videoWidth,
      naturalHeight: video.videoHeight,
    };
    setRect((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.width === next.width &&
      prev.height === next.height &&
      prev.naturalWidth === next.naturalWidth &&
      prev.naturalHeight === next.naturalHeight
        ? prev
        : next,
    );
  }, [videoRef]);

  useEffect(() => {
    measure();
    const video = videoRef.current;
    video?.addEventListener("loadedmetadata", measure);
    window.addEventListener("resize", measure);
    let ro: ResizeObserver | null = null;
    if (video && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(video);
      if (video.parentElement) ro.observe(video.parentElement);
    }
    return () => {
      video?.removeEventListener("loadedmetadata", measure);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [measure, videoRef]);

  return rect;
}
