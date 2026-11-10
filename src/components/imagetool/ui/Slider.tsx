import { useRef } from "react";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Décimales affichées ; par défaut déduites du pas. */
  decimals?: number;
  disabled?: boolean;
  /** Classe du conteneur (marges internes). */
  className?: string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  /** Appelé quand le curseur est relâché sans changement de valeur. */
  onSettle?: () => void;
}

function defaultDecimals(step: number) {
  return step < 0.1 ? 2 : step < 1 ? 1 : 0;
}

/**
 * Curseur à validation au relâchement. Il ne valide que si la valeur a changé depuis la
 * dernière validation : un clic sans déplacement, ou une touche Tab qui ne fait que
 * donner le focus, ne ré-applique plus l'effet.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  decimals = defaultDecimals(step),
  disabled,
  className = "",
  onChange,
  onCommit,
  onSettle,
}: SliderProps) {
  const committed = useRef(value);
  const read = (e: React.SyntheticEvent<HTMLInputElement>) => parseFloat((e.target as HTMLInputElement).value);
  const settle = (e: React.SyntheticEvent<HTMLInputElement>) => {
    if (disabled) return;
    const v = read(e);
    if (v === committed.current) {
      onSettle?.();
      return;
    }
    committed.current = v;
    onCommit(v);
  };

  return (
    <div className={`flex flex-col gap-1 ${disabled ? "opacity-40" : ""} ${className}`}>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="font-mono text-slate-300 tabular-nums">
          {value.toFixed(decimals)}
          {unit ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(read(e))}
        onPointerUp={settle}
        onKeyUp={settle}
        className={`w-full accent-indigo-500 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
        style={{ height: "4px" }}
      />
    </div>
  );
}
