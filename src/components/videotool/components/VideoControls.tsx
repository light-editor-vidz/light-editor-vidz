import { memo, useCallback, useRef, useState } from "react";
import { formatTime } from "../utils/time";
import { PlayIcon, PauseIcon } from "./icons";
import "./VideoControls.css";

interface Props {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
}

function VideoControls({ currentTime, duration, isPlaying, onPlayPause, onSeek }: Props) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const seekbarRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const rect = seekbarRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
    },
    [duration],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isDragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      onSeek(timeFromClientX(e.clientX));
    },
    [timeFromClientX, onSeek],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const t = timeFromClientX(e.clientX);
      setHoverTime(t);
      if (isDragging.current) onSeek(t);
    },
    [timeFromClientX, onSeek],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const hoverPct = hoverTime !== null && duration > 0 ? (hoverTime / duration) * 100 : null;

  return (
    <div className="video-controls">
      {/* Seekbar */}
      <div
        ref={seekbarRef}
        className="seekbar"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHoverTime(null)}
      >
        <div className="seekbar-track">
          <div className="seekbar-fill" style={{ width: `${progress}%` }} />
          <div className="seekbar-thumb" style={{ left: `${progress}%` }}>
            <span className="seekbar-tooltip">{formatTime(hoverTime ?? currentTime)}</span>
          </div>
          {hoverPct !== null && <div className="seekbar-hover-marker" style={{ left: `${hoverPct}%` }} />}
        </div>
      </div>

      {/* Controls row */}
      <div className="controls-row">
        <button className="vc-btn play-btn" onClick={onPlayPause}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <span className="vc-time">
          {formatTime(currentTime)}
          <span className="vc-time-sep"> / </span>
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

export default memo(VideoControls);
