import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** What the menu bar can ask of the screen in front of it. Each screen registers the actions it
 * has; an entry whose action is missing is disabled. */
export interface MenuActions {
  newProject?: () => void;
  openProject?: () => void;
  importLegacy?: () => void;
  closeProject?: () => void;
  openRecent?: (dir: string) => void;
  clearRecent?: () => void;
  save?: () => void;
  openExport?: () => void;
  openSettings?: () => void;
  undo?: () => void;
  redo?: () => void;
  deleteSelected?: () => void;
  duplicateSelected?: () => void;
}

/** What decides whether an entry is enabled: small values, so that the menu is rebuilt only when
 * one of them really changes. */
export interface MenuFlags {
  inEditor: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
}

const NO_FLAGS: MenuFlags = { inEditor: false, canUndo: false, canRedo: false, hasSelection: false };

interface Bridge {
  actions: React.MutableRefObject<MenuActions>;
  flags: MenuFlags;
  setFlags: (patch: Partial<MenuFlags>) => void;
}

const BridgeContext = createContext<Bridge | null>(null);

export function MenuBridgeProvider({ children }: { children: ReactNode }) {
  const actions = useRef<MenuActions>({});
  const [flags, setFlagsState] = useState<MenuFlags>(NO_FLAGS);
  const setFlags = useCallback(
    (patch: Partial<MenuFlags>) =>
      setFlagsState((current) => {
        const next = { ...current, ...patch };
        return (Object.keys(next) as (keyof MenuFlags)[]).every((k) => next[k] === current[k]) ? current : next;
      }),
    [],
  );
  const value = useMemo(() => ({ actions, flags, setFlags }), [flags, setFlags]);
  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

/** Used outside the provider (a component rendered on its own, in a test): one shared bridge whose
 * flags never change. Tests read the registered actions from it. */
export const inertBridge: Bridge = { actions: { current: {} }, flags: NO_FLAGS, setFlags: () => {} };

export function useMenuBridge(): Bridge {
  return useContext(BridgeContext) ?? inertBridge;
}

/** Registers `actions` for as long as the calling component is mounted. The latest functions are
 * always the ones called, without rebuilding the menu. */
export function useRegisterMenuActions(actions: MenuActions) {
  const { actions: ref } = useMenuBridge();
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  useEffect(() => {
    const keys = Object.keys(latest.current) as (keyof MenuActions)[];
    for (const key of keys) {
      ref.current[key] = ((...args: unknown[]) =>
        (latest.current[key] as ((...a: unknown[]) => void) | undefined)?.(...args)) as never;
    }
    return () => {
      for (const key of keys) delete ref.current[key];
    };
  }, [ref]);
}
