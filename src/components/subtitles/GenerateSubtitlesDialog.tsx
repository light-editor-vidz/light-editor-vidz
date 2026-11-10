import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import { describeError } from "../../lib/errors";
import {
  STT_ENGINES,
  STT_KEYS,
  TRANSLATION_ENGINES,
  TRANSLATION_KEYS,
  WHISPER_MODELS,
  audioTracksOfFile,
  audioTracksOfMedia,
  cancelSubs,
  generateForFile,
  generateForMedia,
  generateForProject,
  getSubsSettings,
  hasApiKey,
  listSubsLanguages,
  saveSubs,
  setApiKey,
  setSubsSettings,
  translateSubs,
  type SubsAudioTrack,
  type SubsFormat,
  type SubsLanguage,
  type SubsOutput,
  type SubsSettings,
} from "../../lib/subs/commands";
import { parseSrt } from "../videotool/utils/srt";
import type { Project } from "../../bindings/Project";
import type { TimedCue } from "../../lib/subs/place";
import "../NewProjectModal.css";
import "./subtitles.css";

/** What the subtitles are generated from. */
export type SubsSource =
  | { kind: "file"; path: string }
  | { kind: "media"; projectDir: string; src: string }
  | { kind: "project"; projectDir: string; project: Project };

interface Props {
  source: SubsSource;
  /** Shown in the header: the name of the video, the sound or the project. */
  label: string;
  onClose: () => void;
  /** Project contexts: adds the cues (in source time) to the project, which maps them to its timeline. */
  onPlace?: (cues: TimedCue[]) => void;
  /** Video view: uses the generated subtitles (SRT text) in the current video. */
  onUse?: (srt: string) => void;
}

const baseName = (p: string) => p.replace(/\\/g, "/").split("/").pop() ?? p;

/** The window that generates subtitles from a video, a sound or a whole project. */
export default function GenerateSubtitlesDialog({ source, label, onClose, onPlace, onUse }: Props) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SubsSettings | null>(null);
  const [languages, setLanguages] = useState<SubsLanguage[]>([]);
  const [tracks, setTracks] = useState<SubsAudioTrack[]>([]);
  const [track, setTrack] = useState<number | null>(null);
  const [target, setTarget] = useState("");
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [typedKeys, setTypedKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; fraction: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubsOutput | null>(null);
  const [place, setPlace] = useState(true);
  const [save, setSave] = useState(false);
  const [format, setFormat] = useState<SubsFormat>("srt");
  const [use, setUse] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const cancelled = useRef(false);

  const sttKey = settings ? STT_KEYS[settings.stt_engine] : null;
  const trKey = settings && target ? TRANSLATION_KEYS[settings.translation_engine] : null;

  const refreshKeys = useCallback(async () => {
    const names = [...Object.values(STT_KEYS), ...Object.values(TRANSLATION_KEYS)].flatMap((k) => (k ? [k[0]] : []));
    const entries = await Promise.all(names.map(async (n) => [n, await hasApiKey(n).catch(() => false)] as const));
    setKeys(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    let alive = true;
    getSubsSettings()
      .then((s) => alive && setSettings(s))
      .catch((e) => alive && setError(describeError(e)));
    listSubsLanguages()
      .then((l) => alive && setLanguages(l))
      .catch(() => {});
    void Promise.resolve().then(refreshKeys);
    if (source.kind !== "project") {
      const load =
        source.kind === "file" ? audioTracksOfFile(source.path) : audioTracksOfMedia(source.projectDir, source.src);
      load
        .then((tr) => {
          if (!alive) return;
          setTracks(tr);
          setTrack(tr.length > 1 ? tr[0].position : null);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // The source is fixed for the lifetime of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const un = listen<{ stage: string; fraction: number }>("pipeline-progress", (e) => setProgress(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const patch = (p: Partial<SubsSettings>) => setSettings((s) => (s ? { ...s, ...p } : s));

  const missingKey = useMemo(() => {
    for (const k of [sttKey, trKey]) {
      if (k && !keys[k[0]] && !(typedKeys[k[0]] ?? "").trim()) return k[1];
    }
    return null;
  }, [sttKey, trKey, keys, typedKeys]);

  async function generate() {
    if (!settings) return;
    setError(null);
    setResult(null);
    setDone(null);
    setProgress(null);
    cancelled.current = false;
    setBusy(true);
    try {
      for (const k of [sttKey, trKey]) {
        const typed = k ? (typedKeys[k[0]] ?? "").trim() : "";
        if (k && typed) await setApiKey(k[0], typed);
      }
      await refreshKeys();
      await setSubsSettings(settings);
      let out =
        source.kind === "file"
          ? await generateForFile(source.path, track)
          : source.kind === "media"
            ? await generateForMedia(source.projectDir, source.src, track)
            : await generateForProject(source.projectDir, source.project);
      if (target && target !== out.language) {
        out = await translateSubs(out.srt_path, out.srt_content, out.language, target);
      }
      setResult(out);
    } catch (e) {
      if (!cancelled.current) setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    cancelled.current = true;
    await cancelSubs().catch(() => {});
  }

  const cues = useMemo(() => (result ? parseSrt(result.srt_content) : []), [result]);

  async function apply() {
    if (!result) return;
    setError(null);
    try {
      if (onPlace && place) onPlace(cues.map(({ start, end, text }) => ({ start, end, text })));
      if (onUse && use) onUse(result.srt_content);
      if (save) {
        const written = await saveSubs(result.srt_path, t("subs.fileFilter"), format, result.srt_content);
        if (!written) return; // dialog closed: stay open
      }
      setDone(t("subs.applied"));
      onClose();
    } catch (e) {
      setError(describeError(e));
    }
  }

  const nothingChosen = !(onPlace && place) && !(onUse && use) && !save;
  const stageLabel = progress
    ? t(`subs.stage.${progress.stage}`, { defaultValue: progress.stage })
    : t("subs.starting");

  // In the body: no ancestor view (video, audio…) can restyle or clip it.
  return createPortal(
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="modal subs-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("subs.title")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{t("subs.title")}</h2>
            <p className="modal-subtitle">{baseName(label)}</p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {!settings ? (
            <p className="modal-hint">{t("subs.loading")}</p>
          ) : result ? (
            <>
              <p className="subs-summary">{t("subs.resultCount", { count: cues.length })}</p>
              <ol className="subs-cues">
                {cues.slice(0, 50).map((c) => (
                  <li key={c.id}>
                    <span className="mono">{c.start.toFixed(1)}s</span> {c.text}
                  </li>
                ))}
              </ol>
              {onPlace && (
                <label className="subs-check">
                  <input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} />
                  {t("subs.addToProject")}
                </label>
              )}
              {onUse && (
                <label className="subs-check">
                  <input type="checkbox" checked={use} onChange={(e) => setUse(e.target.checked)} />
                  {t("subs.useInVideo")}
                </label>
              )}
              <label className="subs-check">
                <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
                {t("subs.saveFile")}
                <select
                  className="field-input subs-format"
                  value={format}
                  disabled={!save}
                  onChange={(e) => setFormat(e.target.value as SubsFormat)}
                  aria-label={t("subs.format")}
                >
                  <option value="srt">SRT</option>
                  <option value="vtt">VTT</option>
                  <option value="ass">ASS</option>
                </select>
              </label>
            </>
          ) : busy ? (
            <div className="subs-progress" role="status">
              <span>{stageLabel}</span>
              <progress max={1} value={progress?.fraction ?? 0} />
            </div>
          ) : (
            <>
              <div className="field-group">
                <label className="field-label" htmlFor="subs-engine">
                  {t("subs.engine")}
                </label>
                <select
                  id="subs-engine"
                  className="field-input"
                  value={settings.stt_engine}
                  onChange={(e) => patch({ stt_engine: e.target.value as SubsSettings["stt_engine"] })}
                >
                  {STT_ENGINES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {settings.stt_engine === "local" && (
                <div className="field-group">
                  <label className="field-label" htmlFor="subs-model">
                    {t("subs.model")}
                  </label>
                  <select
                    id="subs-model"
                    className="field-input"
                    value={settings.whisper_model}
                    onChange={(e) => patch({ whisper_model: e.target.value })}
                  >
                    {WHISPER_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {t(`subs.models.${m}`, { defaultValue: m })}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field-group">
                <label className="field-label" htmlFor="subs-lang">
                  {t("subs.spokenLanguage")}
                </label>
                <select
                  id="subs-lang"
                  className="field-input"
                  value={settings.stt_language}
                  onChange={(e) => patch({ stt_language: e.target.value })}
                >
                  <option value="auto">{t("subs.auto")}</option>
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              {tracks.length > 1 && (
                <div className="field-group">
                  <label className="field-label" htmlFor="subs-track">
                    {t("subs.audioTrack")}
                  </label>
                  <select
                    id="subs-track"
                    className="field-input"
                    value={track ?? ""}
                    onChange={(e) => setTrack(e.target.value === "" ? null : Number(e.target.value))}
                  >
                    {tracks.map((tr) => (
                      <option key={tr.position} value={tr.position}>
                        {[`#${tr.position + 1}`, tr.title, tr.language, tr.codec].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field-group">
                <label className="field-label" htmlFor="subs-target">
                  {t("subs.translateTo")}
                </label>
                <select
                  id="subs-target"
                  className="field-input"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">{t("subs.noTranslation")}</option>
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              {target && (
                <div className="field-group">
                  <label className="field-label" htmlFor="subs-tr-engine">
                    {t("subs.translationEngine")}
                  </label>
                  <select
                    id="subs-tr-engine"
                    className="field-input"
                    value={settings.translation_engine}
                    onChange={(e) =>
                      patch({ translation_engine: e.target.value as SubsSettings["translation_engine"] })
                    }
                  >
                    {TRANSLATION_ENGINES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {[sttKey, trKey].map(
                (k, i) =>
                  k &&
                  !(i === 1 && trKey && sttKey && trKey[0] === sttKey[0]) && (
                    <div className="field-group" key={k[0]}>
                      <label className="field-label" htmlFor={`subs-key-${k[0]}`}>
                        {t("subs.apiKey", { provider: k[1] })}
                      </label>
                      <input
                        id={`subs-key-${k[0]}`}
                        className="field-input"
                        type="password"
                        autoComplete="off"
                        placeholder={keys[k[0]] ? t("subs.keyStored") : ""}
                        value={typedKeys[k[0]] ?? ""}
                        onChange={(e) => setTypedKeys((s) => ({ ...s, [k[0]]: e.target.value }))}
                      />
                    </div>
                  ),
              )}
              {source.kind === "project" && <p className="modal-hint">{t("subs.projectHint")}</p>}
            </>
          )}
          {error && <p className="modal-error">{error}</p>}
          {done && <p className="modal-hint">{done}</p>}
        </div>

        <div className="modal-footer">
          {busy ? (
            <button type="button" className="btn-secondary" onClick={cancel}>
              {t("subs.cancel")}
            </button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={onClose}>
                {t("common.close")}
              </button>
              {result ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={apply}
                  disabled={nothingChosen || cues.length === 0}
                >
                  {t("subs.apply")}
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={generate} disabled={!settings || !!missingKey}>
                  {t("subs.generate")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
