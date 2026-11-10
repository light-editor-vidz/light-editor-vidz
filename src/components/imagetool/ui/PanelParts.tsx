import type { ReactNode } from "react";

export function ResetIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

export function Spinner({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-indigo-400 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

interface SectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Section repliable d'un panneau. Le contenu reste monté même replié (masqué par
 * l'attribut `hidden`) : les curseurs gardent leur position quand on referme la section.
 */
export function Section({ title, open, onToggle, children }: SectionProps) {
  return (
    <div className="border-b border-slate-800">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-800/50 transition-colors"
      >
        <span className="font-medium">{title}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div hidden={!open} className="px-4 pb-4 pt-1 space-y-3">
        {children}
      </div>
    </div>
  );
}
