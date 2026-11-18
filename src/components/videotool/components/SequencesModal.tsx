import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { getApi } from "../api";
import type { Sequence } from "../api";
import { useT } from "../i18n";
import { useVideoOwner } from "../owner";
import { formatTimePrecise, formatTime } from "../utils/time";
import { moveItem } from "../utils/sequences";
import "./SequencesModal.css";

interface Props {
  /** La vidéo entière, telle que le lecteur la lit. */
  videoUrl: string;
  /** Le fichier d'où les séquences sont tirées. */
  videoPath: string;
  onCancel: () => void;
  /** Les séquences retenues, dans l'ordre voulu. */
  onApply: (sequences: Sequence[]) => void;
}

interface Item extends Sequence {
  id: number;
  selected: boolean;
  /** Une image du milieu de la séquence (data URL), quand elle est prête. */
  thumb?: string;
}

/** Distance (px) à partir de laquelle un appui devient un glisser plutôt qu'un clic. */
const DRAG_THRESHOLD = 5;

interface CardProps {
  item: Item;
  /** La séquence tourne en boucle dans l'aperçu. */
  looping?: boolean;
  onToggle: (id: number) => void;
  onPlay: (item: Item) => void;
}

function CardBody({ item, onToggle, looping }: Pick<CardProps, "item" | "onToggle" | "looping">) {
  const { t } = useT();
  return (
    <>
      <input
        type="checkbox"
        className="seq-check"
        checked={item.selected}
        onChange={() => onToggle(item.id)}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={t.sequences_select}
        title={t.sequences_select}
      />
      <div className="seq-thumb-wrap">
        {item.thumb ? (
          <img src={item.thumb} className="seq-thumb" alt="" draggable={false} />
        ) : (
          <div className="seq-thumb seq-thumb-empty" />
        )}
        <span className="seq-play-badge" aria-hidden="true">
          {looping ? "↻" : "▶"}
        </span>
      </div>
      <span className="seq-name">{t.sequences_item(item.id + 1)}</span>
      <span className="seq-range">
        {formatTimePrecise(item.start)} → {formatTimePrecise(item.end)}
      </span>
      <span className="seq-range">{formatTime(item.end - item.start)}</span>
    </>
  );
}

/** Une carte triable : pendant qu'on la déplace, sa place reste marquée en pointillés. */
function SortableCard({ item, onToggle, onPlay, looping }: CardProps) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <li
      ref={setNodeRef}
      className={`seq-item${item.selected ? " is-selected" : ""}${isDragging ? " is-placeholder" : ""}${looping ? " is-looping" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      title={t.sequences_play}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("input")) onPlay(item);
      }}
      {...attributes}
      {...listeners}
    >
      <CardBody item={item} onToggle={onToggle} looping={looping} />
    </li>
  );
}

/** Nombre de vignettes demandées par requête (le maximum accepté par le moteur). */
const THUMBNAIL_BATCH = 200;

export default function SequencesModal({ videoUrl, videoPath, onCancel, onApply }: Props) {
  const owner = useVideoOwner();
  const { t } = useT();
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState(videoUrl);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamed = useRef(false);
  const [playing, setPlaying] = useState(false);
  /** Position dans le rendu (secondes), pour la barre de progression. */
  const [elapsed, setElapsed] = useState(0);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  /** Après un glisser, le clic qui suit le relâchement ne doit pas lancer la lecture. */
  const justDragged = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_THRESHOLD } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  /** Ce que lit l'aperçu : les séquences retenues, dans l'ordre (ou une seule, lue seule). */
  const playlist = useRef<Item[]>([]);
  const cursor = useRef(0);
  /** La séquence lue en boucle dans l'aperçu (un clic sur sa vignette), `null` hors boucle. */
  const [loopId, setLoopId] = useState<number | null>(null);
  const looping = useRef(false);

  const selected = useMemo(() => (items ?? []).filter((i) => i.selected), [items]);
  const total = selected.reduce((sum, s) => sum + (s.end - s.start), 0);
  const selectionKey = selected.map((i) => i.id).join(",");

  useEffect(() => {
    let alive = true;
    getApi(owner)
      .detectScenes(videoPath)
      .then((found) => {
        if (!alive) return;
        setItems(found.map((s, i) => ({ ...s, id: i, selected: true })));
        // Les vignettes arrivent après, par lots de 200 (le maximum d'une requête) : la liste est
        // utilisable sans attendre et un film très découpé n'en perd aucune. Fermer la fenêtre
        // arrête la suite (`alive`).
        void (async () => {
          for (let from = 0; from < found.length; from += THUMBNAIL_BATCH) {
            if (!alive) return;
            const times = found.slice(from, from + THUMBNAIL_BATCH).map((s) => (s.start + s.end) / 2);
            try {
              const frames = await getApi().videoFrames(videoPath, times);
              if (!alive) return;
              setItems(
                (list) =>
                  list &&
                  list.map((i) =>
                    i.id >= from && i.id < from + times.length ? { ...i, thumb: frames[i.id - from] || undefined } : i,
                  ),
              );
            } catch {
              // Pas de vignette pour ce lot : les suivants sont tentés quand même.
            }
          }
        })();
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [videoPath, owner]);

  const cancel = () => {
    // Une détection encore en cours est interrompue.
    if (!items) void getApi(owner).cancelFfmpeg();
    onCancel();
  };

  // Le WebView de Linux peut refuser le protocole interne : la même vidéo par HTTP local.
  const onVideoError = useCallback(() => {
    if (streamed.current) return;
    streamed.current = true;
    getApi()
      .toStreamUrl(videoUrl)
      .then(setSrc)
      .catch(() => {});
  }, [videoUrl]);

  /** Temps du rendu avant le début de la séquence `index` de la liste de lecture (en boucle : sa place dans le rendu). */
  const offsetOf = (index: number) => {
    if (looping.current) {
      const at = selected.findIndex((i) => i.id === playlist.current[0]?.id);
      return at < 0 ? 0 : selected.slice(0, at).reduce((sum, s) => sum + (s.end - s.start), 0);
    }
    return playlist.current.slice(0, index).reduce((sum, s) => sum + (s.end - s.start), 0);
  };

  /** Place l'aperçu au début de la séquence `index` de la liste de lecture courante. */
  const seekTo = (index: number) => {
    const video = videoRef.current;
    const seq = playlist.current[index];
    if (!video || !seq) return;
    cursor.current = index;
    video.currentTime = seq.start;
    setElapsed(offsetOf(index));
  };

  const playFrom = (list: Item[], index: number) => {
    const video = videoRef.current;
    if (!video || list.length === 0) return;
    playlist.current = list;
    seekTo(index);
    void video.play();
  };

  /** Sort de la boucle : l'aperçu reprend le rendu, là où il en est si la séquence en fait partie. */
  const leaveLoop = () => {
    if (!looping.current) return;
    const looped = playlist.current[0];
    looping.current = false;
    setLoopId(null);
    playlist.current = selected;
    const index = selected.findIndex((i) => i.id === looped?.id);
    if (index >= 0) cursor.current = index;
    else seekTo(0);
  };

  // L'aperçu montre toujours le rendu : dès que la sélection ou l'ordre change, il repart du début.
  useEffect(() => {
    looping.current = false;
    setLoopId(null);
    playlist.current = selected;
    videoRef.current?.pause();
    seekTo(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (looping.current) {
      // Le play du lecteur sort de la boucle et continue sur tout le rendu.
      leaveLoop();
      if (video.paused) void video.play();
      return;
    }
    if (!video.paused) {
      video.pause();
      return;
    }
    if (playlist.current.length === 0) playlist.current = selected;
    if (playlist.current.length === 0) return;
    const cur = playlist.current[cursor.current];
    if (!cur || video.currentTime < cur.start || video.currentTime >= cur.end) seekTo(cursor.current);
    void video.play();
  };

  /** La barre de position : un clic sort de la boucle et va à cet instant du rendu. */
  const seekRender = (time: number) => {
    const video = videoRef.current;
    if (!video || selected.length === 0) return;
    if (looping.current) {
      looping.current = false;
      setLoopId(null);
    }
    playlist.current = selected;
    let rest = time;
    for (let i = 0; i < selected.length; i++) {
      const length = selected[i].end - selected[i].start;
      if (rest <= length || i === selected.length - 1) {
        cursor.current = i;
        video.currentTime = selected[i].start + Math.min(rest, length);
        setElapsed(time);
        return;
      }
      rest -= length;
    }
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    const cur = playlist.current[cursor.current];
    if (!video || !cur) return;
    if (video.currentTime >= cur.end) {
      if (looping.current) {
        seekTo(0);
      } else if (cursor.current + 1 < playlist.current.length) {
        seekTo(cursor.current + 1);
      } else {
        video.pause();
        seekTo(0);
      }
      return;
    }
    setElapsed(offsetOf(cursor.current) + Math.max(0, video.currentTime - cur.start));
  };

  // `timeupdate` n'arrive que ~4 fois par seconde : pendant la lecture, on surveille la fin des
  // séquences plus finement pour ne pas déborder sur la suivante.
  const tick = useRef(onTimeUpdate);
  tick.current = onTimeUpdate;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => tick.current(), 40);
    return () => clearInterval(id);
  }, [playing]);

  const toggle = (id: number) =>
    setItems((list) => list && list.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)));

  /** Un clic sur une carte joue sa séquence en boucle dans l'aperçu. */
  const playItem = (item: Item) => {
    looping.current = true;
    setLoopId(item.id);
    playFrom([item], 0);
  };

  const onDragStart = (e: DragStartEvent) => setDraggingId(Number(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setDraggingId(null);
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 100);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((list) => {
      if (!list) return list;
      const from = list.findIndex((i) => i.id === active.id);
      const to = list.findIndex((i) => i.id === over.id);
      return moveItem(list, from, to);
    });
  };

  const onPlayCard = (item: Item) => {
    if (!justDragged.current) playItem(item);
  };

  return (
    <div className="seq-backdrop" onClick={cancel}>
      <div
        className="seq-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t.sequences_title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="seq-header">
          <h2>{t.sequences_title}</h2>
          <button className="seq-close" onClick={cancel} aria-label={t.sequences_cancel}>
            ×
          </button>
        </div>

        <video
          ref={videoRef}
          className="seq-video"
          src={src}
          onError={onVideoError}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onClick={togglePlay}
        />
        <div className="seq-player">
          <button
            className="seq-playpause"
            onClick={togglePlay}
            disabled={selected.length === 0}
            title={playing ? t.sequences_preview_pause : t.sequences_preview_play}
            aria-label={playing ? t.sequences_preview_pause : t.sequences_preview_play}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            type="range"
            className="seq-seek"
            min={0}
            max={total || 1}
            step={0.01}
            value={Math.min(elapsed, total)}
            disabled={selected.length === 0}
            onChange={(e) => seekRender(Number(e.target.value))}
            aria-label={t.sequences_seek}
          />
          <span className="seq-time">
            {formatTime(elapsed)} / {formatTime(total)}
          </span>
        </div>

        {failed ? (
          <p className="seq-message seq-error" role="alert">
            {t.sequences_error_detect}
          </p>
        ) : !items ? (
          <p className="seq-message" role="status">
            <span className="loading-spinner seq-spinner" />
            {t.sequences_detecting}
          </p>
        ) : (
          <>
            <p className="seq-hint">{t.sequences_hint}</p>
            {selected.length === 0 && <p className="seq-message">{t.sequences_empty}</p>}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToHorizontalAxis]}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setDraggingId(null)}
            >
              <SortableContext items={items.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
                <ol className="seq-list">
                  {items.map((s) => (
                    <SortableCard key={s.id} item={s} looping={loopId === s.id} onToggle={toggle} onPlay={onPlayCard} />
                  ))}
                </ol>
              </SortableContext>
              <DragOverlay>
                {draggingId !== null && items.find((i) => i.id === draggingId) ? (
                  <div className="seq-item seq-overlay is-selected">
                    <CardBody item={items.find((i) => i.id === draggingId)!} onToggle={toggle} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </>
        )}

        <div className="seq-footer">
          <span className="seq-total">{items ? t.sequences_total(selected.length, formatTime(total)) : ""}</span>
          <button className="btn-ghost" onClick={cancel}>
            {t.sequences_cancel}
          </button>
          <button
            className="btn-primary"
            onClick={() => onApply(selected.map(({ start, end }) => ({ start, end })))}
            disabled={selected.length === 0}
          >
            {t.sequences_apply}
          </button>
        </div>
      </div>
    </div>
  );
}
