import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";

/** Menu contextuel à une seule entrée, « Éditer », pour ouvrir un média dans son onglet. */
export function useEditMenu(): {
  open: (e: ReactMouseEvent, run: () => void) => void;
  menu: ReactNode;
} {
  const { t } = useTranslation();
  const [state, setState] = useState<{ x: number; y: number; run: () => void } | null>(null);

  const open = useCallback((e: ReactMouseEvent, run: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, run });
  }, []);

  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [state]);

  const menu = state && (
    <div
      className="edit-menu"
      role="menu"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        autoFocus
        onClick={() => {
          state.run();
          setState(null);
        }}
      >
        <Pencil size={12} />
        {t("editMenu.edit")}
      </button>
    </div>
  );
  return { open, menu };
}
