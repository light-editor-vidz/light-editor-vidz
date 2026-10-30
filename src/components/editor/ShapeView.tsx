import type { CSSProperties } from "react";
import type { ShapeElement } from "../../bindings/ShapeElement";

/** Longueur du modèle (contour, pointillés, rayon) → CSS : `--u` = pixels par unité (1/1000 de la
 * largeur du canvas, posée par `CanvasStage`), comme `LENGTH_UNITS_PER_WIDTH` côté export. */
const units = (value: number) => `calc(var(--u, 1px) * ${value})`;

const STAR_INNER_RATIO = 0.42;

/** Étoile étirée à la boîte (viewBox 100×100) : même géométrie que `shape_path` (Rust). */
function starPoints(): string {
  return Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI * i) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : STAR_INNER_RATIO;
    return `${50 + 50 * r * Math.cos(angle)},${50 + 50 * r * Math.sin(angle)}`;
  }).join(" ");
}

const STAR_POINTS = starPoints();

/**
 * Forme vectorielle. Le SVG est étiré à la boîte (`preserveAspectRatio="none"`) ; les épaisseurs
 * de contour et pointillés restent uniformes (`non-scaling-stroke`, exprimés en unités du
 * modèle) et le rayon d'angle est converti en rx/ry pour rester circulaire malgré l'étirement.
 * `aspect` = hauteur / largeur du canvas.
 */
export default function ShapeView({ element, aspect = 9 / 16 }: { element: ShapeElement; aspect?: number }) {
  const { id, shape_type, fill, stroke, stroke_width, border_radius, stroke_dash, gradient_to, gradient_angle } =
    element;
  const fillValue = gradient_to ? `url(#grad-${id})` : fill;

  const strokeStyle = (color: string): CSSProperties =>
    stroke_width > 0
      ? {
          stroke: color,
          strokeWidth: units(stroke_width),
          strokeDasharray: stroke_dash ? `${units(stroke_dash)} ${units(stroke_dash)}` : undefined,
        }
      : {};
  const shapeProps = {
    fill: fillValue,
    vectorEffect: "non-scaling-stroke" as const,
    style: stroke !== "none" ? strokeStyle(stroke) : undefined,
  };

  // Vecteur de direction du dégradé sur le carré unitaire (même construction que `draw_shape`).
  const angleRad = ((gradient_angle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(angleRad) / 2;
  const dy = Math.sin(angleRad) / 2;

  // Rayon d'angle : en cqw (1 unité = 0,1 cqw), borné à la moitié du plus petit côté de la boîte.
  const boxW = element.width;
  const boxH = element.height * aspect;
  const radiusCqw = Math.min(((border_radius ?? 0) / 10) as number, Math.min(boxW, boxH) / 2);
  const rx = boxW > 0 ? (radiusCqw / boxW) * 100 : 0;
  const ry = boxH > 0 ? (radiusCqw / boxH) * 100 : 0;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ pointerEvents: "none", overflow: "visible" }}
    >
      {gradient_to && (
        <defs>
          <linearGradient
            id={`grad-${id}`}
            x1={`${50 - dx * 100}%`}
            y1={`${50 - dy * 100}%`}
            x2={`${50 + dx * 100}%`}
            y2={`${50 + dy * 100}%`}
          >
            <stop offset="0%" stopColor={fill} />
            <stop offset="100%" stopColor={gradient_to} />
          </linearGradient>
        </defs>
      )}
      {shape_type === "rectangle" && <rect x={0} y={0} width={100} height={100} rx={rx} ry={ry} {...shapeProps} />}
      {shape_type === "ellipse" && <ellipse cx={50} cy={50} rx={50} ry={50} {...shapeProps} />}
      {shape_type === "triangle" && <polygon points="50,0 100,100 0,100" {...shapeProps} />}
      {shape_type === "line" && (
        <line
          x1={0}
          y1={50}
          x2={100}
          y2={50}
          // Sans couleur de contour, la ligne est tracée avec son remplissage (comme à l'export).
          fill="none"
          vectorEffect="non-scaling-stroke"
          style={strokeStyle(stroke !== "none" ? stroke : fillValue)}
        />
      )}
      {shape_type === "arrow" && <polygon points="0,40 70,40 70,20 100,50 70,80 70,60 0,60" {...shapeProps} />}
      {shape_type === "star" && <polygon points={STAR_POINTS} {...shapeProps} />}
    </svg>
  );
}
