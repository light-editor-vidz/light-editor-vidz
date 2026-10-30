import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { Element } from "../../bindings/Element";
import { assetUrl } from "../../lib/assetUrl";
import { useMediaSource } from "../../lib/useMediaSource";

/**
 * Vues de rendu des éléments du canvas (texte, image, vidéo — les formes ont déjà `ShapeView`).
 * Mémoïsées : pendant la lecture, le parent re-rend à chaque frame mais les props de ces vues
 * ne changent que si l'élément lui-même change (ou, pour la vidéo, le temps local — nécessaire
 * à la synchronisation).
 */

/** Longueur du modèle (rayon, bordure, ombre) → CSS : `--u` = pixels par unité (1/1000 de la
 * largeur du canvas, posée par `CanvasStage`), comme `LENGTH_UNITS_PER_WIDTH` côté export. */
const units = (value: number) => `calc(var(--u, 1px) * ${value})`;

/** Hauteur de ligne (multiplicateur de la taille de police) quand elle n'est pas réglée. */
const DEFAULT_LINE_HEIGHT = 1.25;
/** Taille de repli (cqw) du mode « auto » tant que la boîte n'a pas pu être mesurée. */
const AUTO_FONT_FALLBACK_CQW = 4;
const AUTO_FONT_MIN_CQW = 0.05;
const AUTO_FONT_MAX_CQW = 100;
const AUTO_FONT_STEPS = 12;

type TextElement = Extract<Element, { type: "text" }>;

function textStyle(element: TextElement, fontSizeCqw: number): CSSProperties {
  return {
    fontSize: `${fontSizeCqw}cqw`,
    fontFamily: element.font_family || undefined,
    fontWeight: element.font_weight === "bold" ? 800 : 500,
    fontStyle: element.font_style ?? undefined,
    letterSpacing: element.letter_spacing ? `${element.letter_spacing}cqw` : undefined,
    lineHeight: element.line_height ?? DEFAULT_LINE_HEIGHT,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
}

/**
 * Plus grande taille de police (cqw) pour laquelle le texte complet tient dans la boîte — même
 * recherche par dichotomie que `autofit_font_size_px` (export). `probe` est une copie masquée du
 * texte, de la largeur de la boîte, dont on mesure la hauteur.
 */
function fitFontSize(box: HTMLElement, probe: HTMLElement): number | null {
  const w = box.clientWidth;
  const h = box.clientHeight;
  if (!w || !h) return null;
  const fits = (cqw: number) => {
    probe.style.fontSize = `${cqw}cqw`;
    return probe.offsetHeight <= h + 0.5 && probe.scrollWidth <= w + 0.5;
  };
  let lo = AUTO_FONT_MIN_CQW;
  let hi = AUTO_FONT_MAX_CQW;
  if (!fits(lo)) return lo;
  for (let i = 0; i < AUTO_FONT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export const TextElementView = memo(function TextElementView({
  element,
  content,
}: {
  element: TextElement;
  content: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [autoSize, setAutoSize] = useState<number | null>(null);
  const isAuto = element.font_size === null;

  // Taille « auto » : mesurée sur le texte complet (pas sur le texte partiellement révélé), et
  // recalculée quand la boîte est redimensionnée.
  useLayoutEffect(() => {
    if (!isAuto) return;
    const box = boxRef.current;
    const probe = probeRef.current;
    if (!box || !probe) return;
    const update = () => setAutoSize(fitFontSize(box, probe));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [
    isAuto,
    element.content,
    element.font_family,
    element.font_weight,
    element.font_style,
    element.letter_spacing,
    element.line_height,
  ]);

  const fontSize = element.font_size ?? autoSize ?? AUTO_FONT_FALLBACK_CQW;
  return (
    <div
      ref={boxRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems:
          element.vertical_alignment === "top"
            ? "flex-start"
            : element.vertical_alignment === "bottom"
              ? "flex-end"
              : "center",
        justifyContent:
          element.alignment === "left" ? "flex-start" : element.alignment === "right" ? "flex-end" : "center",
        textAlign: element.alignment,
        color: element.color,
        background: element.background_color ?? undefined,
        // Flou et décalage de l'ombre : 2,5 / 5 unités, comme `SHADOW_*_FRACTION` côté export.
        textShadow: element.text_shadow ? `${units(2.5)} ${units(2.5)} ${units(5)} ${element.text_shadow}` : undefined,
        textDecoration:
          element.underline && element.strikethrough
            ? "underline line-through"
            : element.underline
              ? "underline"
              : element.strikethrough
                ? "line-through"
                : undefined,
        pointerEvents: "none",
        ...textStyle(element, fontSize),
      }}
    >
      {isAuto && (
        <div
          ref={probeRef}
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            visibility: "hidden",
            ...textStyle(element, 1),
          }}
        >
          {element.content}
        </div>
      )}
      {content}
    </div>
  );
});

/** Style du média selon le mode d'ajustement : le conteneur (flex, centré, rogné) porte le fond ;
 * `fit-width` / `fit-height` fixent une seule dimension et laissent l'autre déborder (rognée),
 * comme `fit_scale` côté export. */
function mediaFit(mode: Extract<Element, { type: "image" | "video" }>["fit_mode"]): CSSProperties {
  switch (mode) {
    case "stretch":
      return { width: "100%", height: "100%", objectFit: "fill" };
    case "cover":
      return { width: "100%", height: "100%", objectFit: "cover" };
    case "fit-width":
      return { width: "100%", height: "auto", flexShrink: 0 };
    case "fit-height":
      return { width: "auto", height: "100%", flexShrink: 0 };
    default:
      return { width: "100%", height: "100%", objectFit: "contain" };
  }
}

/** Conteneur rogné d'une image/vidéo : rayon d'angle, bordure intérieure (en unités du modèle). */
function mediaFrameStyle(element: Extract<Element, { type: "image" | "video" }>): CSSProperties {
  return {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: element.background_color ?? undefined,
    borderRadius: element.corner_radius ? units(element.corner_radius) : undefined,
    ...(element.border_color
      ? {
          borderWidth: units(element.border_width ?? 2),
          borderStyle: "solid" as const,
          borderColor: element.border_color,
        }
      : {}),
    boxSizing: "border-box",
  };
}

export const ImageElementView = memo(function ImageElementView({
  element,
  projectDir,
  panTransform,
}: {
  element: Extract<Element, { type: "image" }>;
  projectDir: string;
  panTransform: string;
}) {
  return (
    <div style={mediaFrameStyle(element)}>
      <img
        src={assetUrl(projectDir, element.src)}
        alt={element.name}
        style={{
          ...mediaFit(element.fit_mode),
          pointerEvents: "none",
          transform: panTransform || undefined,
        }}
      />
    </div>
  );
});

export const VideoElementView = memo(function VideoElementView({
  element,
  projectDir,
  localTime,
  playing,
  panTransform,
}: {
  element: Extract<Element, { type: "video" }>;
  projectDir: string;
  localTime: number;
  playing: boolean;
  panTransform: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<{ code: number; message: string } | null>(null);
  const { src: mediaSrc, usingBlob, blobError, fallBack } = useMediaSource(projectDir, element.src);
  const { t } = useTranslation();

  // Un échec de chargement du repli blob est affiché comme erreur de décodage.
  useEffect(() => {
    if (blobError) setError({ code: 0, message: blobError });
  }, [blobError]);

  // Réglages : seulement quand ils changent (pas à chaque image de lecture).
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.playbackRate = element.playback_speed > 0.01 ? element.playback_speed : 1;
    // Le volume et le muet de l'élément s'appliquent aussi en preview (même comportement
    // qu'à l'export).
    video.volume = Math.min(1, Math.max(0, element.volume));
    video.muted = element.muted || element.volume <= 0.001;
  }, [element.playback_speed, element.volume, element.muted, mediaSrc]);

  // Lecture / pause : seulement quand `playing` change ou quand la source arrive.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (playing && !video.ended) {
      video.play().catch(() => {
        // Politique d'autoplay : si la lecture avec son est refusée, rejouer en muet plutôt
        // que de figer la vidéo.
        video.muted = true;
        video.play().catch(() => {});
      });
    } else {
      video.pause();
    }
  }, [playing, mediaSrc]);

  // Synchronisation de la position sur l'horloge de l'éditeur (à chaque image : un simple test
  // de dérive, le saut n'a lieu que s'il dépasse 0,25 s).
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const speed = element.playback_speed > 0.01 ? element.playback_speed : 1;
    let targetTime = Math.max(0, localTime - element.start_time) * speed + element.video_offset;
    // Une fois la source vidéo épuisée (élément plus long que la source), soit on boucle
    // (retour au point d'entrée `video_offset`), soit on fige sur la dernière frame — sans quoi
    // `currentTime` continue de dépasser `duration`, ce que le navigateur clamp en boucle et
    // qui produit un scintillement visible.
    const sourceDuration = video.duration;
    if (sourceDuration > 0 && targetTime >= sourceDuration) {
      const loopSpan = sourceDuration - element.video_offset;
      targetTime =
        element.loop_video && loopSpan > 0.05
          ? ((targetTime - element.video_offset) % loopSpan) + element.video_offset
          : sourceDuration - 0.05;
      targetTime = Math.max(0, targetTime);
    }
    if (Math.abs(video.currentTime - targetTime) > 0.25) {
      video.currentTime = targetTime;
    }
  }, [localTime, mediaSrc, element.start_time, element.video_offset, element.playback_speed, element.loop_video]);

  return (
    <div style={mediaFrameStyle(element)}>
      <video
        ref={ref}
        src={mediaSrc ?? undefined}
        style={{
          ...mediaFit(element.fit_mode),
          pointerEvents: "none",
          transform: panTransform || undefined,
        }}
        preload="auto"
        loop={element.loop_video}
        onError={(e) => {
          const mediaError = e.currentTarget.error;
          // Le flux `lvmedia://` refusé par la webview : on retente avec l'URL blob avant de
          // signaler une erreur à l'utilisateur.
          if (!usingBlob) {
            fallBack();
            return;
          }
          setError({ code: mediaError?.code ?? 0, message: mediaError?.message ?? "" });
        }}
        onLoadedData={() => setError(null)}
      />
      {error && (
        <div className="video-error-overlay">
          <span>{t("canvas.videoDecodeError")}</span>
          <span className="video-error-detail">
            {t("canvas.videoDecodeErrorCode", { code: error.code })}
            {error.message ? ` — ${error.message}` : ""}
          </span>
        </div>
      )}
    </div>
  );
});
