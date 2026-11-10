import { useEffect, useState } from "react";
import { useCommandParams } from "./hooks/useCommandParams";
import type { PanelCtx } from "./hooks/useCommandParams";
import { useCommitSession } from "./hooks/useCommitSession";
import { useT } from "./lib/langContext";
import type { Command, FilterCommand, ImageMeta } from "./types";
import { ResetIcon, Section, Spinner } from "./ui/PanelParts";
import { Slider as BaseSlider } from "./ui/Slider";

export type { FilterCommand };

interface FiltersPanelProps {
  tabId: string | null;
  image: ImageMeta | null;
  isLoading: boolean;
  historyIndex?: number;
  onApply: (cmd: Command, opts?: { replace: true }) => Promise<number | void>;
  onPreview: (cmd: Command | null) => void;
  onReset?: () => void;
  canReset?: boolean;
}

// ── Préréglages ───────────────────────────────────────────────────────────────

interface Preset {
  id: string;
  nameKey: string;
  /** Approximation CSS pour la seule vignette : le rendu appliqué est calculé par le backend. */
  css: string;
  cmd: FilterCommand;
}

const PRESETS: Preset[] = [
  {
    id: "grayscale",
    nameKey: "fil.preset.bw",
    css: "grayscale(1)",
    cmd: { type: "grayscale", rWeight: 0.299, gWeight: 0.587, bWeight: 0.114 },
  },
  {
    id: "sepia",
    nameKey: "fil.preset.sepia",
    css: "sepia(1)",
    cmd: { type: "sepia", intensity: 1.0 },
  },
  { id: "invert", nameKey: "fil.preset.invert", css: "invert(1)", cmd: { type: "invert" } },
  {
    id: "lomo",
    nameKey: "fil.preset.lomo",
    css: "saturate(1.6) contrast(1.2) brightness(0.88)",
    cmd: { type: "lomo", intensity: 1.0 },
  },
  {
    id: "vintage",
    nameKey: "fil.preset.vintage",
    css: "sepia(0.4) contrast(0.9) brightness(1.05) saturate(0.85)",
    cmd: { type: "vintage", intensity: 1.0 },
  },
  {
    id: "cool",
    nameKey: "fil.preset.cool",
    css: "hue-rotate(20deg) saturate(1.15) brightness(1.05)",
    cmd: { type: "cool", intensity: 1.0 },
  },
  {
    id: "warm",
    nameKey: "fil.preset.warm",
    css: "hue-rotate(-15deg) saturate(1.2) brightness(1.05)",
    cmd: { type: "warm", intensity: 1.0 },
  },
  {
    id: "fade",
    nameKey: "fil.preset.fade",
    css: "contrast(0.7) brightness(1.2) saturate(0.8)",
    cmd: { type: "fade", intensity: 1.0 },
  },
  {
    id: "drama",
    nameKey: "fil.preset.drama",
    css: "contrast(1.5) brightness(0.85) saturate(0.7)",
    cmd: { type: "drama", intensity: 1.0 },
  },
  {
    id: "cross",
    nameKey: "fil.preset.cross",
    css: "saturate(1.5) hue-rotate(15deg) contrast(1.1)",
    cmd: { type: "cross-process", intensity: 1.0 },
  },
  {
    id: "sketch",
    nameKey: "fil.preset.sketch",
    css: "grayscale(1) contrast(4) brightness(1.5)",
    cmd: { type: "sketch" },
  },
];

// ── Duotone ───────────────────────────────────────────────────────────────────

interface DuotonePair {
  id: string;
  shadow: [number, number, number];
  highlight: [number, number, number];
}

const DUOTONE_PAIRS: DuotonePair[] = [
  { id: "gold-teal", shadow: [60, 20, 0], highlight: [200, 230, 120] },
  { id: "purple-yellow", shadow: [80, 0, 120], highlight: [250, 220, 0] },
  { id: "cyan-red", shadow: [0, 80, 140], highlight: [220, 40, 20] },
  { id: "navy-peach", shadow: [10, 20, 80], highlight: [255, 180, 120] },
  { id: "forest-sun", shadow: [20, 60, 20], highlight: [255, 220, 80] },
  { id: "noir-blanc", shadow: [20, 20, 20], highlight: [240, 240, 240] },
];

/** Curseur des filtres : deux décimales dès que le pas n'est pas entier. */
function Slider(props: React.ComponentProps<typeof BaseSlider>) {
  return <BaseSlider className="px-3 py-1.5" decimals={Number.isInteger(props.step) ? 0 : 2} {...props} />;
}

// ── Sections ──────────────────────────────────────────────────────────────────

/** Section à un seul curseur d'intensité (0–1). */
function IntensitySection({
  ctx,
  type,
  label,
}: {
  ctx: PanelCtx;
  type: "sepia" | "lomo" | "vintage" | "cool" | "warm" | "fade" | "drama" | "cross-process";
  label: string;
}) {
  const { values, set, commit, settle } = useCommandParams(
    { intensity: 1.0 },
    (v) => ({ type, ...v }),
    ctx,
    type,
    null,
  );
  return (
    <Slider
      label={label}
      value={values.intensity}
      min={0}
      max={1}
      step={0.01}
      onChange={(v) => set({ intensity: v })}
      onCommit={commit}
      onSettle={settle}
    />
  );
}

function Grayscale({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { rWeight: 0.299, gWeight: 0.587, bWeight: 0.114 },
    (v) => ({ type: "grayscale", ...v }),
    ctx,
    "grayscale",
    null,
  );
  const channels = [
    ["rWeight", "fil.red"],
    ["gWeight", "fil.green"],
    ["bWeight", "fil.blue"],
  ] as const;
  return (
    <>
      {channels.map(([field, labelKey]) => (
        <Slider
          key={field}
          label={t(labelKey)}
          value={values[field]}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => set({ [field]: v })}
          onCommit={commit}
          onSettle={settle}
        />
      ))}
    </>
  );
}

function Vignette({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { strength: 0.7, feather: 0.5 },
    (v) => ({ type: "vignette", ...v }),
    ctx,
    "vignette",
    null,
  );
  return (
    <>
      <Slider
        label={t("fil.strength")}
        value={values.strength}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => set({ strength: v })}
        onCommit={commit}
        onSettle={settle}
      />
      <Slider
        label={t("fil.feather")}
        value={values.feather}
        min={0.05}
        max={1}
        step={0.01}
        onChange={(v) => set({ feather: v })}
        onCommit={commit}
        onSettle={settle}
      />
    </>
  );
}

function Grain({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { amount: 0.3, monochrome: true },
    (v) => ({ type: "grain", ...v }),
    ctx,
    "grain",
    null,
  );
  return (
    <>
      <Slider
        label={t("fil.intensity")}
        value={values.amount}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => set({ amount: v })}
        onCommit={commit}
        onSettle={settle}
      />
      <div className="flex items-center gap-2 px-3 py-1.5">
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={values.monochrome}
            className="accent-indigo-500 w-3.5 h-3.5"
            onChange={(e) => {
              set({ monochrome: e.target.checked });
              commit();
            }}
          />
          {t("fil.monochrome")}
        </label>
      </div>
    </>
  );
}

function Pixelate({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { size: 10 },
    (v) => ({ type: "pixelate", ...v }),
    ctx,
    "pixelate",
    null,
  );
  return (
    <Slider
      label={t("fil.size")}
      value={values.size}
      min={2}
      max={100}
      step={1}
      unit="px"
      onChange={(v) => set({ size: v })}
      onCommit={commit}
      onSettle={settle}
    />
  );
}

function Posterize({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { levels: 4 },
    (v) => ({ type: "posterize", ...v }),
    ctx,
    "posterize",
    null,
  );
  return (
    <Slider
      label={t("fil.levels")}
      value={values.levels}
      min={2}
      max={16}
      step={1}
      onChange={(v) => set({ levels: v })}
      onCommit={commit}
      onSettle={settle}
    />
  );
}

type BlurType = "gaussian" | "motion" | "radial";

function Blur({ ctx }: { ctx: PanelCtx }) {
  const t = useT();
  const { values, set, commit, settle } = useCommandParams(
    { type: "gaussian" as BlurType, radius: 3, angle: 0, distance: 10, strength: 0.3, samples: 12 },
    (b): Command =>
      b.type === "gaussian"
        ? { type: "blur-gaussian", radius: b.radius }
        : b.type === "motion"
          ? { type: "blur-motion", angle: b.angle, distance: b.distance }
          : { type: "blur-radial", strength: b.strength, samples: b.samples },
    ctx,
    "blur",
    null,
  );
  return (
    <>
      <div className="flex gap-1 px-3 pt-1 pb-0.5">
        {(["gaussian", "motion", "radial"] as const).map((bt) => (
          <button
            key={bt}
            onClick={() => set({ type: bt })}
            className={`flex-1 text-[10px] py-1 rounded transition-colors ${values.type === bt ? "bg-indigo-600 text-white" : "bg-slate-700 text-slate-400 hover:text-slate-200"}`}
          >
            {t(`fil.blur.${bt}`)}
          </button>
        ))}
      </div>

      {values.type === "gaussian" && (
        <Slider
          label={t("fil.radius")}
          value={values.radius}
          min={0.5}
          max={30}
          step={0.5}
          unit="px"
          onChange={(v) => set({ radius: v })}
          onCommit={commit}
          onSettle={settle}
        />
      )}

      {values.type === "motion" && (
        <>
          <Slider
            label={t("fil.angle")}
            value={values.angle}
            min={0}
            max={360}
            step={1}
            unit="°"
            onChange={(v) => set({ angle: v })}
            onCommit={commit}
            onSettle={settle}
          />
          <Slider
            label={t("fil.distance")}
            value={values.distance}
            min={1}
            max={50}
            step={1}
            unit="px"
            onChange={(v) => set({ distance: v })}
            onCommit={commit}
            onSettle={settle}
          />
        </>
      )}

      {values.type === "radial" && (
        <>
          <Slider
            label={t("fil.strength")}
            value={values.strength}
            min={0}
            max={0.95}
            step={0.01}
            onChange={(v) => set({ strength: v })}
            onCommit={commit}
            onSettle={settle}
          />
          <Slider
            label={t("fil.samples")}
            value={values.samples}
            min={4}
            max={32}
            step={1}
            onChange={(v) => set({ samples: v })}
            onCommit={commit}
            onSettle={settle}
          />
        </>
      )}
    </>
  );
}

// ── Panneau ───────────────────────────────────────────────────────────────────

export function FiltersPanel({
  tabId,
  image,
  isLoading,
  historyIndex = 0,
  onApply,
  onPreview,
  onReset,
  canReset = false,
}: FiltersPanelProps) {
  const t = useT();
  const [openSection, setOpenSection] = useState<string | null>(null);
  const { commit, endSession, overlayRef, keyFor, resetAll } = useCommitSession({
    tabId,
    historyIndex,
    onApply,
    onPreview,
  });
  const ctx: PanelCtx = { preview: onPreview, commit };

  useEffect(() => () => onPreview(null), [onPreview]);

  /** Application ponctuelle (préréglage, duotone) : une étape à part entière. */
  const applyOnce = (cmd: Command) => {
    endSession();
    void commit(cmd, null);
  };

  if (!tabId) return null;

  const section = (id: string, titleKey: string, body: React.ReactNode) => (
    <Section
      key={id}
      title={t(titleKey)}
      open={openSection === id}
      onToggle={() => setOpenSection((s) => (s === id ? null : id))}
    >
      {body}
    </Section>
  );
  const intensity = (id: "sepia" | "lomo" | "vintage" | "fade" | "drama" | "cross-process", titleKey: string) =>
    section(id, titleKey, <IntensitySection key={keyFor(id)} ctx={ctx} type={id} label={t("fil.intensity")} />);

  return (
    <div className="w-64 shrink-0 bg-slate-900 border-l border-slate-700 flex flex-col overflow-hidden relative">
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-slate-900/60 z-10 flex items-center justify-center"
        style={{ display: isLoading ? "flex" : "none" }}
      >
        <Spinner className="w-6 h-6" />
      </div>

      <div className="px-3 py-2.5 border-b border-slate-700 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">{t("fil.header")}</span>
          <div className="flex items-center gap-1.5">
            {onReset && (
              <button
                onClick={() => {
                  resetAll();
                  onReset();
                }}
                disabled={!canReset || isLoading}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title={t("adj.reset")}
                aria-label={t("adj.reset")}
              >
                <ResetIcon />
              </button>
            )}
            {isLoading && <Spinner className="w-3.5 h-3.5" />}
          </div>
        </div>
        {isLoading && <div className="mt-1.5 h-0.5 bg-indigo-500/30 rounded animate-pulse" />}
      </div>

      <div className="overflow-y-auto flex-1">
        <div className="grid grid-cols-3 gap-1.5 p-2">
          {PRESETS.map((preset) => {
            const presetName = t(preset.nameKey);
            return (
              <button
                key={preset.id}
                className="flex flex-col items-center gap-1 p-1 rounded hover:bg-slate-700/50 transition-colors group"
                onClick={() => applyOnce(preset.cmd)}
                title={presetName}
              >
                <div className="w-full aspect-video overflow-hidden rounded-sm bg-slate-800">
                  {image ? (
                    <img
                      src={image.thumbnail || image.preview}
                      alt={presetName}
                      className="w-full h-full object-cover"
                      style={{ filter: preset.css, imageRendering: "auto" }}
                      draggable={false}
                    />
                  ) : (
                    <div className="w-full h-full bg-slate-700/50" />
                  )}
                </div>
                <span className="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors leading-none">
                  {presetName}
                </span>
              </button>
            );
          })}
        </div>

        {section("grayscale", "fil.sec.bw-mixer", <Grayscale key={keyFor("grayscale")} ctx={ctx} />)}
        {section("vignette", "fil.sec.vignette", <Vignette key={keyFor("vignette")} ctx={ctx} />)}
        {section("grain", "fil.sec.grain", <Grain key={keyFor("grain")} ctx={ctx} />)}
        {section("pixelate", "fil.sec.pixelate", <Pixelate key={keyFor("pixelate")} ctx={ctx} />)}
        {section("posterize", "fil.sec.posterize", <Posterize key={keyFor("posterize")} ctx={ctx} />)}
        {section("blur", "fil.sec.blur", <Blur key={keyFor("blur")} ctx={ctx} />)}
        {intensity("sepia", "fil.sec.sepia")}
        {intensity("lomo", "fil.sec.lomo")}
        {intensity("vintage", "fil.sec.vintage")}
        {section(
          "coolwarm",
          "fil.sec.coolwarm",
          <>
            <IntensitySection key={keyFor("cool")} ctx={ctx} type="cool" label={t("fil.preset.cool")} />
            <IntensitySection key={keyFor("warm")} ctx={ctx} type="warm" label={t("fil.preset.warm")} />
          </>,
        )}
        {intensity("fade", "fil.sec.fade")}
        {intensity("drama", "fil.sec.drama")}
        {intensity("cross-process", "fil.sec.cross")}
        {section(
          "duotone",
          "fil.sec.duotone",
          <div className="flex flex-col gap-1">
            {DUOTONE_PAIRS.map((pair) => (
              <button
                key={pair.id}
                onClick={() =>
                  applyOnce({
                    type: "duotone",
                    shadowR: pair.shadow[0],
                    shadowG: pair.shadow[1],
                    shadowB: pair.shadow[2],
                    highlightR: pair.highlight[0],
                    highlightG: pair.highlight[1],
                    highlightB: pair.highlight[2],
                  })
                }
                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors text-left"
              >
                <span
                  className="w-4 h-4 rounded-sm shrink-0 border border-slate-600"
                  style={{ background: `rgb(${pair.shadow.join(",")})` }}
                />
                <span
                  className="w-4 h-4 rounded-sm shrink-0 border border-slate-600"
                  style={{ background: `rgb(${pair.highlight.join(",")})` }}
                />
                {t(`fil.duo.${pair.id}`)}
              </button>
            ))}
          </div>,
        )}
      </div>
    </div>
  );
}
