import { formatNumber } from "../../../lib/format";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "type"> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Décimales conservées à l'affichage (la saisie n'est pas arrondie). */
  decimals?: number;
}

/**
 * Champ numérique de panneau de propriétés. Le texte saisi est gardé localement : vider le champ
 * ou taper « 1, » n'envoie rien (au lieu de forcer 0), les décimales sont possibles, et la valeur
 * envoyée est bornée à `min`/`max`. À la perte du focus, le champ retombe sur la dernière valeur
 * valide.
 */
export function NumberField({ value, onChange, min, max, decimals = 2, onBlur, onFocus, ...rest }: Props) {
  const [text, setText] = useState(formatNumber(value, decimals));
  const focused = useRef(false);

  useEffect(() => {
    // Valeur modifiée ailleurs (annulation, poignée du canvas) : le champ suit, sauf en cours de frappe.
    if (!focused.current) setText(formatNumber(value, decimals));
  }, [value, decimals]);

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const raw = e.target.value.trim();
        if (raw === "") return;
        const parsed = Number(raw.replace(",", "."));
        if (!Number.isFinite(parsed)) return;
        const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
        onChange(bounded);
      }}
      onBlur={(e) => {
        focused.current = false;
        setText(formatNumber(value, decimals));
        onBlur?.(e);
      }}
    />
  );
}
