import { useCallback, useEffect, useRef, useState } from "react";
import { getApi } from "../api";
import { useT } from "../i18n";
import type { QueueJob } from "../api";
import "./QueueManager.css";

export const SHOW_QUEUE_EVENT = "lcv:show-queue";

const isActive = (j: QueueJob) => j.status === "queued" || j.status === "running";

/**
 * The export queue: a small pill (visible on every screen as soon as there is a
 * job) and the window listing the jobs. It owns its own state, fed by the main
 * process, so it also keeps working while another video is being edited.
 */
export default function QueueManager() {
  const { t } = useT();
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [open, setOpen] = useState(false);
  // The initial snapshot is a request, the updates are pushes: whichever order
  // they arrive in, a push is newer than the snapshot and must not be overwritten by it.
  const gotUpdate = useRef(false);

  useEffect(() => {
    let alive = true;
    getApi()
      .queueList()
      .then((list) => {
        if (alive && !gotUpdate.current) setJobs(list);
      })
      .catch(() => {});
    const off = getApi().onQueueUpdate((list) => {
      gotUpdate.current = true;
      setJobs(list);
    });
    const show = () => setOpen(true);
    window.addEventListener(SHOW_QUEUE_EVENT, show);
    return () => {
      alive = false;
      off();
      window.removeEventListener(SHOW_QUEUE_EVENT, show);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const cancel = useCallback((id: number) => {
    void getApi().queueCancel(id);
  }, []);
  const reveal = useCallback((id: number) => {
    void getApi().queueReveal(id);
  }, []);
  const clear = useCallback(() => {
    void getApi().queueClearFinished();
  }, []);

  if (jobs.length === 0) return null;

  const active = jobs.filter(isActive);
  const running = jobs.find((j) => j.status === "running");
  const waiting = active.filter((j) => j.status === "queued").length;
  const failed = jobs.some((j) => j.status === "error");

  const label = running
    ? `${t.queue_button(active.length)} · ${running.progress}%`
    : active.length > 0
      ? t.queue_button(active.length)
      : t.queue_idle;

  return (
    <>
      <button
        className={`queue-pill ${running ? "busy" : failed ? "failed" : "idle"}`}
        onClick={() => setOpen(true)}
        title={t.queue_title}
        aria-label={t.queue_title}
      >
        {running && <span className="queue-dot" aria-hidden="true" />}
        <span>{label}</span>
        {waiting > 0 && <span className="queue-waiting">{t.queue_waiting(waiting)}</span>}
      </button>

      {open && (
        <div className="queue-backdrop" onClick={() => setOpen(false)}>
          <div
            className="queue-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t.queue_title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="queue-header">
              <h2>{t.queue_title}</h2>
              <button className="queue-close" onClick={() => setOpen(false)} aria-label={t.queue_close}>
                ×
              </button>
            </div>
            <ul className="queue-list">
              {jobs.map((job) => (
                <li key={job.id} className={`queue-job status-${job.status}`}>
                  <div className="queue-job-top">
                    <span className="queue-name" title={job.outputPath}>
                      {job.name}
                    </span>
                    <span className="queue-format">{job.format.toUpperCase()}</span>
                    <span className="queue-status">{t[`queue_status_${job.status}`]}</span>
                  </div>
                  {(job.status === "running" || job.status === "queued") && (
                    <div
                      className="queue-bar"
                      role="progressbar"
                      aria-valuenow={job.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div className="queue-fill" style={{ width: `${job.progress}%` }} />
                    </div>
                  )}
                  {job.status === "error" && job.error && <div className="queue-error">{job.error}</div>}
                  <div className="queue-actions">
                    {isActive(job) && (
                      <button className="btn-ghost" onClick={() => cancel(job.id)}>
                        {t.queue_cancel}
                      </button>
                    )}
                    {job.status === "done" && (
                      <button className="btn-ghost" onClick={() => reveal(job.id)}>
                        {t.queue_show}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="queue-footer">
              <button className="btn-ghost" onClick={clear} disabled={jobs.every(isActive)}>
                {t.queue_clear}
              </button>
              <button className="btn-primary" onClick={() => setOpen(false)}>
                {t.queue_close}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
