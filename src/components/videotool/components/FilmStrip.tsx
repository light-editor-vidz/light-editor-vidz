import { memo, useEffect, useState } from "react";
import { getApi } from "../api";
import "./FilmStrip.css";

interface Props {
  /** Le fichier vidéo dont les vignettes sont tirées (par ffmpeg, côté backend). */
  videoPath: string;
  duration: number;
  trackWidth: number;
}

const THUMB_W = 80;

function FilmStrip({ videoPath, duration, trackWidth }: Props) {
  const [thumbs, setThumbs] = useState<string[]>([]);

  // Depend on the number of thumbnails, not the pixel width: dragging the window
  // edge changes the width on every frame but rarely the count, and each change
  // re-extracts every frame of the video.
  const count = trackWidth > 0 ? Math.max(4, Math.ceil(trackWidth / THUMB_W)) : 0;

  useEffect(() => {
    if (!videoPath || duration <= 0 || count <= 0) return;
    // A late answer for a previous video must not write into the strip of the current one.
    let aborted = false;
    getApi()
      .videoThumbnails(videoPath, count)
      .then((found) => {
        if (!aborted) setThumbs(found);
      })
      .catch(() => {
        if (!aborted) setThumbs([]);
      });
    return () => {
      aborted = true;
    };
  }, [videoPath, duration, count]);

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
