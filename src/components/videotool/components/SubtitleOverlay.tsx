import { useEffect, useState, Fragment, type CSSProperties } from "react";
import type { SubtitlesState, CropRect } from "../types";
import type { SubtitleCue } from "../utils/srt";
import {
  getActiveCues,
  getWordWindows,
  getActiveWordIndex,
  getActiveCharCount,
  RAINBOW_PALETTE,
} from "../utils/subtitles";
import { useVideoRect } from "../hooks/useVideoRect";
import "./SubtitleOverlay.css";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  subtitles: SubtitlesState | null;
  currentTime: number;
  /** The crop that will be exported: subtitles are laid out on the cropped picture. */
  crop?: CropRect | null;
}

const POSITION_JUSTIFY: Record<string, string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

function renderMultiline(text: string) {
  return text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line}
    </Fragment>
  ));
}

export default function SubtitleOverlay({ videoRef, subtitles, currentTime, crop }: Props) {
  const pictureRect = useVideoRect(videoRef);

  // `timeupdate` only fires about four times a second, far too coarse for
  // word-by-word animation. While the video plays, follow its clock per frame;
  // otherwise (paused, seeking) the prop is exact.
  const [liveTime, setLiveTime] = useState<number | null>(null);
  const active = !!subtitles;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;
    let raf = 0;
    const tick = () => {
      setLiveTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      setLiveTime(null);
    };
    if (!video.paused && !video.ended) start();
    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    video.addEventListener("ended", stop);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("ended", stop);
    };
  }, [videoRef, active]);
  const time = liveTime ?? currentTime;

  if (!subtitles || !pictureRect) return null;

  const activeCues = getActiveCues(subtitles.cues, time);
  if (activeCues.length === 0) return null;

  // The export burns subtitles into the *cropped* frame, so lay them out there.
  const pxPerSource = pictureRect.naturalWidth > 0 ? pictureRect.width / pictureRect.naturalWidth : 1;
  const rect = crop
    ? {
        left: pictureRect.left + crop.x * pxPerSource,
        top: pictureRect.top + crop.y * pxPerSource,
        width: crop.w * pxPerSource,
        height: crop.h * pxPerSource,
      }
    : pictureRect;
  // ASS outlines are in output pixels; scale to what is on screen. A CSS stroke is
  // centred on the glyph edge (half hidden under the fill), an ASS outline lies
  // wholly outside it, hence the factor 2.
  const outputHeight = crop ? crop.h : pictureRect.naturalHeight || rect.height;
  const strokePx = 2 * subtitles.style.outlineWidth * (rect.height / outputHeight);

  const { style, animation } = subtitles;
  const fontSize = (style.fontSize / 100) * rect.height;
  const marginV = rect.height * 0.06;

  const textStyle: CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: `${fontSize}px`,
    color: style.color,
    fontWeight: 700,
    WebkitTextStrokeWidth: strokePx,
    WebkitTextStrokeColor: style.outlineColor,
    paintOrder: "stroke fill",
    backgroundColor:
      style.backgroundOpacity > 0 ? hexToRgba(style.backgroundColor, style.backgroundOpacity) : "transparent",
    padding: style.backgroundOpacity > 0 ? "0.2em 0.5em" : 0,
    borderRadius: style.backgroundOpacity > 0 ? "0.2em" : 0,
  };

  const renderCue = (cue: SubtitleCue): React.ReactNode => {
    let content: React.ReactNode = null;

    if (animation === "word-pop") {
      const idx = getActiveWordIndex(cue, time);
      const words = getWordWindows(cue);
      const word = words[idx]?.text;
      if (word) {
        content = (
          <span key={`${cue.id}-${idx}`} className="sub-word-pop" style={textStyle}>
            {word}
          </span>
        );
      }
    } else if (animation === "word-bounce") {
      const idx = getActiveWordIndex(cue, time);
      const words = getWordWindows(cue);
      const word = words[idx]?.text;
      if (word) {
        content = (
          <span key={`${cue.id}-${idx}`} className="sub-word-bounce" style={textStyle}>
            {word}
          </span>
        );
      }
    } else if (animation === "rainbow") {
      const words = getWordWindows(cue);
      content = (
        <span key={cue.id} className="sub-sentence-fade" style={textStyle}>
          {words.map((w, i) => (
            <span key={i} style={{ color: RAINBOW_PALETTE[i % RAINBOW_PALETTE.length] }}>
              {w.text}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      );
    } else if (animation === "typewriter") {
      const count = getActiveCharCount(cue, time);
      const text = Array.from(cue.text).slice(0, count).join("");
      content = (
        <span className="sub-typewriter" style={textStyle}>
          {renderMultiline(text)}
        </span>
      );
    } else if (animation === "word-highlight") {
      const words = getWordWindows(cue);
      const idx = getActiveWordIndex(cue, time);
      content = (
        <span className="sub-highlight-line" style={textStyle}>
          {words.map((w, i) => (
            <span key={i} style={i === idx ? { color: style.accentColor } : undefined}>
              {w.text}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </span>
      );
    } else if (animation === "sentence-slide") {
      content = (
        <span key={cue.id} className="sub-sentence-slide" style={textStyle}>
          {renderMultiline(cue.text)}
        </span>
      );
    } else {
      // sentence-fade (default fallback)
      content = (
        <span key={cue.id} className="sub-sentence-fade" style={textStyle}>
          {renderMultiline(cue.text)}
        </span>
      );
    }

    return content;
  };

  return (
    <div
      className="subtitle-overlay"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        justifyContent: POSITION_JUSTIFY[style.position] || "flex-end",
        padding: `${marginV}px 24px`,
      }}
    >
      {activeCues.map((cue) => (
        <Fragment key={cue.id}>{renderCue(cue)}</Fragment>
      ))}
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
