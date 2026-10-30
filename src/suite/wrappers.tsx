import type { ReactNode } from "react";
import { SuiteRoot } from "./SuiteRoot";
import { suiteMessages } from "./messages";

export const getT = (lang: "en" | "fr") => (key: string, vars?: Record<string, string | number>) => {
  let s = (suiteMessages[lang] as Record<string, string>)[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.split(`{${k}}`).join(String(v));
  return s;
};

/** The parts every app of the suite shares (update check, banner, What's new), around `ui`. */
export function withSuite(
  ui: ReactNode,
  {
    fetchNotes = () => Promise.resolve(""),
    changelogs = { en: "", fr: "" },
    lang = "en",
  }: {
    fetchNotes?: (lang: "en" | "fr", version: string) => Promise<string>;
    changelogs?: { en: string; fr: string };
    lang?: "en" | "fr";
  } = {},
) {
  return (
    <SuiteRoot
      lang={lang}
      t={getT(lang)}
      appId="test"
      appName="Test"
      changelogs={changelogs}
      fetchNotes={fetchNotes}
      checkOnStart={false}
    >
      {ui}
    </SuiteRoot>
  );
}
