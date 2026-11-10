import { memo, useEffect, useState } from "react";
import "./FilmStrip.css";

interface Props {
  videoUrl: string;
  duration: number;
  trackWidth: number;
}

const THUMB_W = 80;
const THUMB_H = 45;

function FilmStrip({ videoUrl, duration, trackWidth }: Props) {
  const [thumbs, setThumbs] = useState<string[]>([]);

  // Depend on the number of thumbnails, not the pixel width: dragging the window
  // edge changes the width on every frame but rarely the count, and each change
  // re-extracts every frame of the video.
  const count = trackWidth > 0 ? Math.max(4, Math.ceil(trackWidth / THUMB_W)) : 0;

  useEffect(() => {
    if (!videoUrl || duration <= 0 || count <= 0) return;
    // Local to this run: a late `seeked` of a previous video must not write
    // into the strip of the current one.
    let aborted = false;

    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.src = videoUrl;

    const canvas = document.createElement("canvas");
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const captured: string[] = [];
    let index = 0;

    const captureFrame = () => {
      if (aborted) return;
      // Crop to the thumbnail's aspect ratio instead of squashing the frame, so
      // portrait and ultra-wide videos are not distorted.
      const vw = video.videoWidth || THUMB_W;
      const vh = video.videoHeight || THUMB_H;
      const targetRatio = THUMB_W / THUMB_H;
      let sw = vw;
      let sh = vh;
      if (vw / vh > targetRatio) sw = vh * targetRatio;
      else sh = vw / targetRatio;
      ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, THUMB_W, THUMB_H);
      captured.push(canvas.toDataURL("image/jpeg", 0.6));
      setThumbs([...captured]);
      index++;
      if (index < count) {
        // Never seek to exactly `duration`: many players emit no `seeked` event
        // there, or decode a black frame, losing the last thumbnail.
        video.currentTime = Math.min((index / (count - 1)) * duration, Math.max(0, duration - 0.05));
      }
    };

    video.addEventListener("seeked", captureFrame);
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = 0;
    });

    return () => {
      aborted = true;
      // `src = ''` would make the element fetch the page's own URL.
      video.removeAttribute("src");
      video.load();
    };
  }, [videoUrl, duration, count]);

  if (thumbs.length === 0) return <div className="filmstrip filmstrip-empty" />;

  return (
    <div className="filmstrip">
      {thumbs.map((src, i) => (
        <img key={i} src={src} className="filmstrip-thumb" draggable={false} alt="" />
      ))}
    </div>
  );
}

export default memo(FilmStrip);
