import { useCallback, useState } from "react";
import { useCommandParams } from "./hooks/useCommandParams";
import type { PanelCtx } from "./hooks/useCommandParams";
import { useCommitSession } from "./hooks/useCommitSession";
import { useT } from "./lib/langContext";
import type { AdjustmentCommand, Command } from "./types";
import { ResetIcon, Section, Spinner } from "./ui/PanelParts";
import { Slider } from "./ui/Slider";
import { useEffect, useRef } from "react";

export type { AdjustmentCommand };

interface AdjustmentsPanelProps {
  tabId: string | null;
  isLoading: boolean;
  historyIndex?: number;
  onApply: (cmd: Command, opts?: { replace: true }) => Promise<number | void>;
  onPreview: (cmd: Command | null) => void;
  onReset?: () => void;
  canReset?: boolean;
}

// ─── Curve LUT ───────────────────────────────────────────────────────────────

function computeCurveLut(raw: [number, number][]): number[] {
  // Mêmes règles que le backend (`build_curve_lut`) : tri, fusion des points confondus,
  // extrémités (0,0) et (1,1) ajoutées si absentes.
  let pts = [...raw].sort((a, b) => a[0] - b[0]);
  pts = pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) >= 1e-4);
  if (pts.length === 0 || pts[0][0] > 0.01) pts = [[0, 0], ...pts];
  if (pts[pts.length - 1][0] < 0.99) pts = [...pts, [1, 1]];
  const n = pts.length;
  if (n < 2) return Array.from({ length: 256 }, (_, i) => i);
  const delta: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const dx = pts[k + 1][0] - pts[k][0];
    delta.push(dx < 1e-9 ? 0 : (pts[k + 1][1] - pts[k][1]) / dx);
  }
  const m = new Array<number>(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = (delta[k - 1] + delta[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (Math.abs(delta[k]) < 1e-9) {
      m[k] = 0;
      m[k + 1] = 0;
    } else {
      const a = m[k] / delta[k],
        b = m[k + 1] / delta[k],
        sq = a * a + b * b;
      if (sq > 9) {
        const t = 3 / Math.sqrt(sq);
        m[k] = t * a * delta[k];
        m[k + 1] = t * b * delta[k];
      }
    }
  }
  return Array.from({ length: 256 }, (_, i) => {
    const x = i / 255;
    let seg = 0;
    for (let k = 0; k < n - 1; k++) {
      if (x >= pts[k][0]) seg = k;
    }
    const h = pts[seg + 1][0] - pts[seg][0];
    const t = h < 1e-9 ? 0 : Math.max(0, Math.min(1, (x - pts[seg][0]) / h));
    const t2 = t * t,
      t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * pts[seg][1] +
      (t3 - 2 * t2 + t) * h * m[seg] +
      (-2 * t3 + 3 * t2) * pts[seg + 1][1] +
      (t3 - t2) * h * m[seg + 1];
    return Math.max(0, Math.min(255, Math.round(y * 255)));
  });
}

// ─── Curves canvas ───────────────────────────────────────────────────────────

const CW = 200,
  CH = 200,
  HIT_R = 9;

function ptToCanvas(px: number, py: number): [number, number] {
  return [px * CW, CH - py * CH];
}
function canvasToPt(cx: number, cy: number): [number, number] {
  return [Math.max(0, Math.min(1, cx / CW)), Math.max(0, Math.min(1, 1 - cy / CH))];
}
function findNearest(cx: number, cy: number, pts: [number, number][]): number {
  for (let i = 0; i < pts.length; i++) {
    const [pcx, pcy] = ptToCanvas(pts[i][0], pts[i][1]);
    if (Math.hypot(cx - pcx, cy - pcy) <= HIT_R) return i;
  }
  return -1;
}

function CurvesEditor({
  userPoints,
  onChange,
  onCommit,
}: {
  userPoints: [number, number][];
  onChange: (pts: [number, number][]) => void;
  onCommit: (pts: [number, number][]) => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragIdxRef = useRef<number | null>(null);
  const ptsRef = useRef(userPoints);
  useEffect(() => {
    ptsRef.current = userPoints;
  }, [userPoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((CW * i) / 4, 0);
      ctx.lineTo((CW * i) / 4, CH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (CH * i) / 4);
      ctx.lineTo(CW, (CH * i) / 4);
      ctx.stroke();
    }
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, CH);
    ctx.lineTo(CW, 0);
    ctx.stroke();
    const lut = computeCurveLut(userPoints);
    ctx.strokeStyle = "#818cf8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * CW,
        y = CH - (lut[i] / 255) * CH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (const [px, py] of userPoints) {
      const [cx, cy] = ptToCanvas(px, py);
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#818cf8";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [userPoints]);

  const clientToCanvas = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(CW, (e.clientX - rect.left) * (CW / rect.width))),
      Math.max(0, Math.min(CH, (e.clientY - rect.top) * (CH / rect.height))),
    ];
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const [cx, cy] = clientToCanvas(e);
    const pts = ptsRef.current;
    const idx = findNearest(cx, cy, pts);
    if (idx >= 0) {
      dragIdxRef.current = idx;
      return;
    }
    if (pts.length >= 10) return;
    const newPt = canvasToPt(cx, cy);
    const newPts: [number, number][] = [...pts, newPt].sort((a, b) => a[0] - b[0]);
    dragIdxRef.current = newPts.findIndex(
      (p) => Math.abs(p[0] - newPt[0]) < 0.001 && Math.abs(p[1] - newPt[1]) < 0.001,
    );
    ptsRef.current = newPts;
    onChange(newPts);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const idx = dragIdxRef.current;
    if (idx === null || idx < 0) return;
    const [cx, cy] = clientToCanvas(e);
    const pts = [...ptsRef.current];
    pts[idx] = canvasToPt(cx, cy);
    ptsRef.current = pts;
    onChange(pts);
  };

  const finalizeDrag = () => {
    if (dragIdxRef.current !== null) {
      const sorted: [number, number][] = [...ptsRef.current].sort((a, b) => a[0] - b[0]);
      ptsRef.current = sorted;
      onChange(sorted);
      onCommit(sorted);
    }
    dragIdxRef.current = null;
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const [cx, cy] = clientToCanvas(e);
    const idx = findNearest(cx, cy, ptsRef.current);
    if (idx >= 0) {
      const newPts = ptsRef.current.filter((_, i) => i !== idx);
      ptsRef.current = newPts;
      onChange(newPts);
      onCommit(newPts);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvasRef}
        width={CW}
        height={CH}
        className="w-full rounded border border-slate-700 cursor-crosshair"
        style={{ imageRendering: "pixelated" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={finalizeDrag}
        onMouseLeave={finalizeDrag}
        onContextMenu={handleContextMenu}
      />
      <p className="text-xs text-slate-600">{t("adj.curves-hint")}</p>
    </div>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function BrightnessContrast({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { brightness: 0, contrast: 0 },
    (v) => ({ type: "brightness-contrast", ...v }),
    ctx,
    "bc",
  );
  return (
    <>
      <Slider
        label={t("adj.brightness")}
        value={values.brightness}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => set({ brightness: v })}
        onCommit={commit}
        onSettle={settle}
      />
      <Slider
        label={t("adj.contrast")}
        value={values.contrast}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => set({ contrast: v })}
        onCommit={commit}
        onSettle={settle}
      />
    </>
  );
}

function Exposure({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { exposure: 0 },
    (v) => ({ type: "exposure", ...v }),
    ctx,
    "exposure",
  );
  return (
    <Slider
      label={t("adj.exposure-label")}
      value={values.exposure}
      min={-3}
      max={3}
      step={0.05}
      unit=" EV"
      onChange={(v) => set({ exposure: v })}
      onCommit={commit}
      onSettle={settle}
    />
  );
}

function HueSaturation({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { hue: 0, saturation: 0, lightness: 0 },
    (v) => ({ type: "hue-saturation", ...v }),
    ctx,
    "hsl",
  );
  return (
    <>
      {(["hue", "saturation", "lightness"] as const).map((field) => (
        <Slider
          key={field}
          label={t(`adj.${field}`)}
          value={values[field]}
          min={field === "hue" ? -180 : -100}
          max={field === "hue" ? 180 : 100}
          step={1}
          unit={field === "hue" ? "°" : undefined}
          onChange={(v) => set({ [field]: v })}
          onCommit={commit}
          onSettle={settle}
        />
      ))}
    </>
  );
}

function Vibrance({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { vibrance: 0 },
    (v) => ({ type: "vibrance", ...v }),
    ctx,
    "vibrance",
  );
  return (
    <Slider
      label={t("adj.vibrance-label")}
      value={values.vibrance}
      min={-100}
      max={100}
      step={1}
      onChange={(v) => set({ vibrance: v })}
      onCommit={commit}
      onSettle={settle}
    />
  );
}

function Levels({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { inBlack: 0, inWhite: 255, gamma: 1.0, outBlack: 0, outWhite: 255 },
    (v) => ({ type: "levels", ...v }),
    ctx,
    "levels",
  );
  const common = { step: 1, onCommit: commit, onSettle: settle };
  return (
    <>
      <Slider
        {...common}
        label={t("adj.in-black")}
        value={values.inBlack}
        min={0}
        max={253}
        onChange={(v) => set((c) => ({ inBlack: Math.min(v, c.inWhite - 2) }))}
      />
      <Slider
        {...common}
        label={t("adj.in-white")}
        value={values.inWhite}
        min={2}
        max={255}
        onChange={(v) => set((c) => ({ inWhite: Math.max(v, c.inBlack + 2) }))}
      />
      <Slider
        label={t("adj.gamma")}
        value={values.gamma}
        min={0.1}
        max={10}
        step={0.05}
        onCommit={commit}
        onSettle={settle}
        onChange={(v) => set({ gamma: v })}
      />
      <Slider
        {...common}
        label={t("adj.out-black")}
        value={values.outBlack}
        min={0}
        max={255}
        onChange={(v) => set((c) => ({ outBlack: Math.min(v, c.outWhite - 1) }))}
      />
      <Slider
        {...common}
        label={t("adj.out-white")}
        value={values.outWhite}
        min={0}
        max={255}
        onChange={(v) => set((c) => ({ outWhite: Math.max(v, c.outBlack + 1) }))}
      />
    </>
  );
}

function Curves({ ctx }: { ctx: PanelCtx }) {
  const [points, setPoints] = useState<[number, number][]>([]);
  return (
    <CurvesEditor
      userPoints={points}
      onChange={(pts) => {
        setPoints(pts);
        ctx.preview(pts.length === 0 ? null : { type: "curves", points: pts });
      }}
      onCommit={(pts) => ctx.commit({ type: "curves", points: pts }, "curves")}
    />
  );
}

function WhiteBalance({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { temperature: 0, tint: 0 },
    (v) => ({ type: "white-balance", ...v }),
    ctx,
    "wb",
  );
  return (
    <>
      <Slider
        label={t("adj.temperature")}
        value={values.temperature}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => set({ temperature: v })}
        onCommit={commit}
        onSettle={settle}
      />
      <Slider
        label={t("adj.tint")}
        value={values.tint}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => set({ tint: v })}
        onCommit={commit}
        onSettle={settle}
      />
    </>
  );
}

function Sharpen({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { amount: 100, radius: 1.0, threshold: 0 },
    (v) => ({ type: "sharpen", ...v }),
    ctx,
    "sharpen",
  );
  return (
    <>
      <Slider
        label={t("adj.amount")}
        value={values.amount}
        min={0}
        max={200}
        step={1}
        onChange={(v) => set({ amount: v })}
        onCommit={commit}
        onSettle={settle}
      />
      <Slider
        label={t("adj.radius")}
        value={values.radius}
        min={0.1}
        max={5}
        step={0.1}
        onChange={(v) => set({ radius: v })}
        onCommit={commit}
        onSettle={settle}
      />
      <Slider
        label={t("adj.threshold")}
        value={values.threshold}
        min={0}
        max={255}
        step={1}
        onChange={(v) => set({ threshold: v })}
        onCommit={commit}
        onSettle={settle}
      />
    </>
  );
}

function Denoise({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { strength: 0 },
    (v) => ({ type: "denoise", ...v }),
    ctx,
    "denoise",
  );
  return (
    <Slider
      label={t("adj.strength")}
      value={values.strength}
      min={0}
      max={100}
      step={1}
      onChange={(v) => set({ strength: v })}
      onCommit={commit}
      onSettle={settle}
    />
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

const SECTIONS: Array<{
  id: string;
  titleKey: string;
  Body: (p: { ctx: PanelCtx }) => React.ReactNode;
}> = [
  { id: "bc", titleKey: "adj.brightness-contrast", Body: BrightnessContrast },
  { id: "exposure", titleKey: "adj.exposure", Body: Exposure },
  { id: "hsl", titleKey: "adj.hue-saturation", Body: HueSaturation },
  { id: "vibrance", titleKey: "adj.vibrance", Body: Vibrance },
  { id: "levels", titleKey: "adj.levels", Body: Levels },
  { id: "curves", titleKey: "adj.curves", Body: Curves },
  { id: "wb", titleKey: "adj.white-balance", Body: WhiteBalance },
  { id: "sharpen", titleKey: "adj.sharpen", Body: Sharpen },
  { id: "denoise", titleKey: "adj.denoise", Body: Denoise },
];

export function AdjustmentsPanel({
  tabId,
  isLoading,
  historyIndex = 0,
  onApply,
  onPreview,
  onReset,
  canReset = false,
}: AdjustmentsPanelProps) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const { commit, overlayRef, keyFor, resetAll } = useCommitSession({
    tabId,
    historyIndex,
    onApply,
    onPreview,
  });
  const ctx: PanelCtx = { preview: onPreview, commit };

  const handleReset = useCallback(() => {
    resetAll();
    onReset?.();
  }, [resetAll, onReset]);

  useEffect(() => () => onPreview(null), [onPreview]);

  if (!tabId) return null;

  return (
    <aside className="w-72 bg-slate-900 border-l border-slate-700 flex flex-col overflow-hidden shrink-0">
      <div className="border-b border-slate-700 shrink-0">
        <div className="px-4 py-2.5 flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{t("adj.header")}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {onReset && (
              <button
                onClick={handleReset}
                disabled={!canReset || isLoading}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title={t("adj.reset")}
                aria-label={t("adj.reset")}
              >
                <ResetIcon />
              </button>
            )}
            {isLoading && <Spinner />}
          </div>
        </div>
        {isLoading && <div className="h-0.5 bg-indigo-600 animate-pulse" />}
      </div>

      <div className="overflow-y-auto flex-1 relative">
        {/* Toujours dans le DOM, affiché/masqué sans attendre un rendu React */}
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10 bg-slate-900/60 cursor-wait"
          style={{ display: isLoading ? "block" : "none" }}
        />
        {SECTIONS.map(({ id, titleKey, Body }) => (
          <Section
            key={id}
            title={t(titleKey)}
            open={open === id}
            onToggle={() => setOpen((p) => (p === id ? null : id))}
          >
            <Body key={keyFor(id)} ctx={ctx} />
          </Section>
        ))}
      </div>
    </aside>
  );
}
