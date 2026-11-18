import { memo, useEffect, useRef, useState } from "react";
import { getApi } from "../api";
import "./FilmStrip.css";
import { filmStripCache as cache, rememberFilmStrip as remember } from "./filmStripCache";

interface Props {
  /** Le fichier vidéo dont les vignettes sont tirées (par ffmpeg, côté backend). */
  videoPath: string;
  duration: number;
  trackWidth: number;
}

const THUMB_W = 80;
/** Délai sans nouvelle largeur avant de redemander des vignettes. */
const RESIZE_SETTLE_MS = 300;
function FilmStrip({ videoPath, duration, trackWidth }: Props) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const hasThumbs = useRef(false);

  // Depend on the number of thumbnails, not the pixel width: dragging the window
  // edge changes the width on every frame but rarely the count, and each change
  // re-extracts every frame of the video.
  const count = trackWidth > 0 ? Math.max(4, Math.ceil(trackWidth / THUMB_W)) : 0;

  useEffect(() => {
    if (!videoPath || duration <= 0 || count <= 0) return;
    const key = `${videoPath}\n${count}`;
    const known = cache.get(key);
    if (known) {
      setThumbs(known);
      return;
    }
    // A late answer for a previous video must not write into the strip of the current one.
    let aborted = false;
    // Les images déjà là restent affichées pendant un redimensionnement : on attend qu'il se
    // calme avant d'en redemander (chaque demande fait travailler ffmpeg sur le film).
    const wait = hasThumbs.current ? RESIZE_SETTLE_MS : 0;
    const request = () => {
      getApi()
        .videoThumbnails(videoPath, count)
        .then((found) => {
          if (aborted) return;
          remember(key, found);
          setThumbs(found);
          hasThumbs.current = found.length > 0;
        })
        .catch(() => {
          if (!aborted) setThumbs([]);
        });
    };
    const timer = wait > 0 ? setTimeout(request, wait) : undefined;
    if (wait === 0) request();
    return () => {
      aborted = true;
      clearTimeout(timer);
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
