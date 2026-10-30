import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SuiteRoot } from "./suite/SuiteRoot";
import { suiteMessages, type SuiteLang, type SuiteT } from "./suite/messages";
import { changelogs } from "./suite/changelogs";
import { releaseNotes } from "./lib/commands";
import { runBeforeExit } from "./lib/lifecycle";
import { MenuBridgeProvider } from "./lib/menuBridge";

/** The parts every app of the suite shares (menu bar, update check and banner, About, What's new),
 * around the app. */
export default function Root({ children }: { children: ReactNode }) {
  const { i18n, t: appT } = useTranslation();
  const lang: SuiteLang = i18n.resolvedLanguage === "fr" ? "fr" : "en";

  // The suite's own texts first, then the app's (`about.tagline` lives in its locale files).
  const t = useMemo<SuiteT>(
    () => (key, vars) => {
      const own = (suiteMessages[lang] as Record<string, string>)[key];
      if (own === undefined) return appT(key, vars);
      return vars ? Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), own) : own;
    },
    [lang, appT],
  );

  // Pending changes are written before the app restarts on an update.
  const beforeRestart = useCallback(() => runBeforeExit(), []);

  return (
    <SuiteRoot
      lang={lang}
      t={t}
      appId="light-editor-vidz"
      appName="LightEditorVidz"
      changelogs={changelogs}
      fetchNotes={releaseNotes}
      beforeRestart={beforeRestart}
    >
      <MenuBridgeProvider>{children}</MenuBridgeProvider>
    </SuiteRoot>
  );
}
