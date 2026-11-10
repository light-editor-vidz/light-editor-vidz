import { useState } from "react";
import type { ExifField } from "./lib/tauri";
import { useT } from "./lib/langContext";

interface Props {
  tabId: string | null;
  fields: ExifField[];
  isLoading: boolean;
  onStrip: () => Promise<void>;
}

export function ExifPanel({ tabId, fields, isLoading, onStrip }: Props) {
  const t = useT();
  const [stripping, setStripping] = useState(false);

  const handleStrip = async () => {
    if (!tabId || stripping) return;
    setStripping(true);
    try {
      // onClick can't await us, so a rejection here would escape as an
      // unhandled rejection. The parent already surfaces the error.
      await onStrip();
    } catch {
      /* reported upstream */
    } finally {
      setStripping(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-56 border-l border-slate-700 bg-slate-900 flex items-center justify-center text-slate-500 text-xs">
        {t("exif.loading")}
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="w-56 border-l border-slate-700 bg-slate-900 flex items-center justify-center text-slate-500 text-xs px-4 text-center">
        {t("exif.empty")}
      </div>
    );
  }

  return (
    <div className="w-56 border-l border-slate-700 bg-slate-900 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">EXIF</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {fields.map((f, i) => (
          <div key={`${f.tag}-${i}`} className="px-3 py-1.5 border-b border-slate-800 last:border-0">
            <div className="text-slate-400 text-xs leading-tight">{f.tag}</div>
            <div className="text-slate-200 text-xs leading-snug break-words select-text">{f.value}</div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-700 px-3 py-2 flex flex-col gap-1.5">
        <p className="text-slate-500 text-xs leading-snug">{t("exif.lossless")}</p>
        <button
          onClick={handleStrip}
          disabled={!tabId || stripping}
          className="toolbar-btn toolbar-btn--primary w-full py-1.5 text-xs justify-center"
        >
          {stripping ? t("exif.saving") : t("exif.strip")}
        </button>
      </div>
    </div>
  );
}
