//! File d'exports séquentielle. ffmpeg utilise déjà tous les cœurs : les travaux passent l'un
//! après l'autre ; la file en gère le cycle de vie et prévient l'interface.
//!
//!   queued → running → done | error | cancelled
//!
//! Elle ne sait rien de ffmpeg : `execute` fait le travail.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct JobSnapshot {
    pub id: u64,
    pub name: String,
    pub format: String,
    pub status: JobStatus,
    pub progress: u32,
    #[serde(rename = "outputPath")]
    pub output_path: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct JobMeta {
    pub name: String,
    pub format: String,
    pub output_path: String,
}

/// Ce qu'`execute` reçoit pour parler à la file.
pub struct JobContext {
    pub cancel: Arc<AtomicBool>,
    progress: Box<dyn Fn(u32) + Send + Sync>,
}

impl JobContext {
    pub fn set_progress(&self, pct: u32) {
        (self.progress)(pct);
    }
}

struct Job<S> {
    snap: JobSnapshot,
    spec: Option<S>,
    cancel: Arc<AtomicBool>,
}

struct State<S> {
    jobs: Vec<Job<S>>,
    seq: u64,
    shutdown: bool,
}

type Execute<S> = dyn Fn(S, &JobContext) -> Result<(), String> + Send + Sync;
type OnChange = dyn Fn(Vec<JobSnapshot>) + Send + Sync;

pub struct ExportQueue<S: Send + 'static> {
    state: Arc<(Mutex<State<S>>, Condvar)>,
    on_change: Arc<OnChange>,
}

fn active(s: JobStatus) -> bool {
    matches!(s, JobStatus::Queued | JobStatus::Running)
}

impl<S: Send + 'static> ExportQueue<S> {
    /// Crée la file et son fil de travail.
    pub fn new(
        execute: impl Fn(S, &JobContext) -> Result<(), String> + Send + Sync + 'static,
        on_change: impl Fn(Vec<JobSnapshot>) + Send + Sync + 'static,
    ) -> Self {
        let state = Arc::new((
            Mutex::new(State {
                jobs: vec![],
                seq: 0,
                shutdown: false,
            }),
            Condvar::new(),
        ));
        let on_change: Arc<OnChange> = Arc::new(on_change);
        let execute: Arc<Execute<S>> = Arc::new(execute);
        {
            let (state, on_change) = (state.clone(), on_change.clone());
            std::thread::spawn(move || worker(state, on_change, execute));
        }
        Self { state, on_change }
    }

    fn snapshot(state: &State<S>) -> Vec<JobSnapshot> {
        state.jobs.iter().map(|j| j.snap.clone()).collect()
    }

    pub fn list(&self) -> Vec<JobSnapshot> {
        Self::snapshot(&self.state.0.lock().unwrap())
    }

    pub fn get(&self, id: u64) -> Option<JobSnapshot> {
        self.state
            .0
            .lock()
            .unwrap()
            .jobs
            .iter()
            .find(|j| j.snap.id == id)
            .map(|j| j.snap.clone())
    }

    /// Ajoute un travail. Deux travaux qui écrivent le même fichier s'écraseraient : refusé.
    pub fn add(&self, spec: S, meta: JobMeta) -> Result<u64, String> {
        let (lock, cv) = &*self.state;
        let (id, snapshot) = {
            let mut st = lock.lock().unwrap();
            if st
                .jobs
                .iter()
                .any(|j| active(j.snap.status) && j.snap.output_path == meta.output_path)
            {
                return Err("Another queued export already writes to that file".into());
            }
            st.seq += 1;
            let id = st.seq;
            st.jobs.push(Job {
                snap: JobSnapshot {
                    id,
                    name: meta.name,
                    format: meta.format,
                    status: JobStatus::Queued,
                    progress: 0,
                    output_path: meta.output_path,
                    error: None,
                },
                spec: Some(spec),
                cancel: Arc::new(AtomicBool::new(false)),
            });
            (id, Self::snapshot(&st))
        };
        (self.on_change)(snapshot);
        cv.notify_all();
        Ok(id)
    }

    /// Annule un travail en attente d'un coup, ou arrête celui qui tourne. Faux si inconnu ou fini.
    pub fn cancel(&self, id: u64) -> bool {
        let snapshot = {
            let mut st = self.state.0.lock().unwrap();
            let Some(job) = st.jobs.iter_mut().find(|j| j.snap.id == id) else {
                return false;
            };
            if !active(job.snap.status) {
                return false;
            }
            job.cancel.store(true, Ordering::SeqCst);
            if job.snap.status == JobStatus::Queued {
                job.snap.status = JobStatus::Cancelled;
                job.spec = None;
                Some(Self::snapshot(&st))
            } else {
                None
            }
        };
        if let Some(s) = snapshot {
            (self.on_change)(s);
        }
        true
    }

    /// Annule tous les travaux actifs (à la fermeture de l'application).
    pub fn cancel_all(&self) {
        let ids: Vec<u64> = self
            .state
            .0
            .lock()
            .unwrap()
            .jobs
            .iter()
            .filter(|j| active(j.snap.status))
            .map(|j| j.snap.id)
            .collect();
        for id in ids {
            self.cancel(id);
        }
    }

    /// Oublie les travaux finis, garde les actifs.
    pub fn clear_finished(&self) {
        let snapshot = {
            let mut st = self.state.0.lock().unwrap();
            st.jobs.retain(|j| active(j.snap.status));
            Self::snapshot(&st)
        };
        (self.on_change)(snapshot);
    }

    pub fn has_active(&self) -> bool {
        self.state
            .0
            .lock()
            .unwrap()
            .jobs
            .iter()
            .any(|j| active(j.snap.status))
    }

    pub fn active_count(&self) -> usize {
        self.state
            .0
            .lock()
            .unwrap()
            .jobs
            .iter()
            .filter(|j| active(j.snap.status))
            .count()
    }
}

impl<S: Send + 'static> Drop for ExportQueue<S> {
    fn drop(&mut self) {
        self.cancel_all();
        self.state.0.lock().unwrap().shutdown = true;
        self.state.1.notify_all();
    }
}

fn worker<S: Send + 'static>(
    state: Arc<(Mutex<State<S>>, Condvar)>,
    on_change: Arc<OnChange>,
    execute: Arc<Execute<S>>,
) {
    let (lock, cv) = &*state;
    loop {
        // Prochain travail en attente, ou attendre.
        let (id, spec, cancel, snapshot) = {
            let mut st = lock.lock().unwrap();
            loop {
                if st.shutdown {
                    return;
                }
                if let Some(pos) = st
                    .jobs
                    .iter()
                    .position(|j| j.snap.status == JobStatus::Queued)
                {
                    let job = &mut st.jobs[pos];
                    job.snap.status = JobStatus::Running;
                    let spec = job
                        .spec
                        .take()
                        .expect("un travail en attente a sa spécification");
                    let (id, cancel) = (job.snap.id, job.cancel.clone());
                    break (
                        id,
                        spec,
                        cancel,
                        st.jobs.iter().map(|j| j.snap.clone()).collect::<Vec<_>>(),
                    );
                }
                st = cv.wait(st).unwrap();
            }
        };
        on_change(snapshot);

        let ctx = {
            let (state, on_change) = (state.clone(), on_change.clone());
            JobContext {
                cancel: cancel.clone(),
                progress: Box::new(move |pct| {
                    let pct = pct.min(100);
                    let snapshot = {
                        let mut st = state.0.lock().unwrap();
                        let Some(job) = st.jobs.iter_mut().find(|j| j.snap.id == id) else {
                            return;
                        };
                        if job.snap.progress == pct {
                            return;
                        }
                        job.snap.progress = pct;
                        st.jobs.iter().map(|j| j.snap.clone()).collect::<Vec<_>>()
                    };
                    on_change(snapshot);
                }),
            }
        };
        let result = execute(spec, &ctx);

        let snapshot = {
            let mut st = lock.lock().unwrap();
            if let Some(job) = st.jobs.iter_mut().find(|j| j.snap.id == id) {
                if cancel.load(Ordering::SeqCst) {
                    job.snap.status = JobStatus::Cancelled;
                } else {
                    match result {
                        Ok(()) => {
                            job.snap.status = JobStatus::Done;
                            job.snap.progress = 100;
                        }
                        Err(e) => {
                            job.snap.status = JobStatus::Error;
                            job.snap.error = Some(e);
                        }
                    }
                }
            }
            st.jobs.iter().map(|j| j.snap.clone()).collect::<Vec<_>>()
        };
        on_change(snapshot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn meta(out: &str) -> JobMeta {
        JobMeta {
            name: out.into(),
            format: "mp4".into(),
            output_path: out.into(),
        }
    }

    fn wait_for(q: &ExportQueue<u32>, id: u64, status: JobStatus) {
        for _ in 0..500 {
            if q.get(id).map(|j| j.status) == Some(status) {
                return;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("job {id} never reached {status:?}: {:?}", q.get(id));
    }

    #[test]
    fn jobs_run_one_after_the_other_and_finish_done() {
        let (tx, rx) = mpsc::channel();
        let q = ExportQueue::new(
            move |n: u32, ctx: &JobContext| {
                ctx.set_progress(50);
                tx.send(n).unwrap();
                Ok(())
            },
            |_| {},
        );
        let a = q.add(1, meta("/a")).unwrap();
        let b = q.add(2, meta("/b")).unwrap();
        wait_for(&q, b, JobStatus::Done);
        assert_eq!(rx.try_iter().collect::<Vec<_>>(), [1, 2]);
        assert_eq!(q.get(a).unwrap().progress, 100);
        assert!(!q.has_active());
    }

    #[test]
    fn two_jobs_cannot_write_the_same_file_while_active() {
        let (release, wait) = mpsc::channel::<()>();
        let wait = Mutex::new(wait);
        let q = ExportQueue::new(
            move |_: u32, _: &JobContext| {
                let _ = wait.lock().unwrap().recv();
                Ok(())
            },
            |_| {},
        );
        let a = q.add(1, meta("/same")).unwrap();
        assert_eq!(
            q.add(2, meta("/same")).unwrap_err(),
            "Another queued export already writes to that file"
        );
        release.send(()).unwrap();
        wait_for(&q, a, JobStatus::Done);
        // Une fois fini, le fichier peut être réécrit.
        release.send(()).unwrap();
        assert!(q.add(3, meta("/same")).is_ok());
    }

    #[test]
    fn a_failing_job_records_its_error_and_the_queue_goes_on() {
        let q = ExportQueue::new(
            |n: u32, _: &JobContext| if n == 1 { Err("boom".into()) } else { Ok(()) },
            |_| {},
        );
        let a = q.add(1, meta("/a")).unwrap();
        let b = q.add(2, meta("/b")).unwrap();
        wait_for(&q, b, JobStatus::Done);
        let a = q.get(a).unwrap();
        assert_eq!(
            (a.status, a.error.as_deref()),
            (JobStatus::Error, Some("boom"))
        );
    }

    #[test]
    fn a_waiting_job_is_cancelled_outright_and_never_executed() {
        let (release, wait) = mpsc::channel::<()>();
        let wait = Mutex::new(wait);
        let (ran_tx, ran) = mpsc::channel();
        let q = ExportQueue::new(
            move |n: u32, _: &JobContext| {
                ran_tx.send(n).unwrap();
                let _ = wait.lock().unwrap().recv();
                Ok(())
            },
            |_| {},
        );
        let a = q.add(1, meta("/a")).unwrap();
        let b = q.add(2, meta("/b")).unwrap();
        wait_for(&q, a, JobStatus::Running);
        assert!(q.cancel(b));
        assert_eq!(q.get(b).unwrap().status, JobStatus::Cancelled);
        release.send(()).unwrap();
        wait_for(&q, a, JobStatus::Done);
        assert_eq!(ran.try_iter().collect::<Vec<_>>(), [1]);
        assert!(!q.cancel(b), "déjà annulé");
        assert!(!q.cancel(99));
    }

    #[test]
    fn a_running_job_sees_its_cancellation_and_ends_cancelled() {
        let q = ExportQueue::new(
            |_: u32, ctx: &JobContext| {
                while !ctx.cancel.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(2));
                }
                Err("cancelled".into())
            },
            |_| {},
        );
        let a = q.add(1, meta("/a")).unwrap();
        wait_for(&q, a, JobStatus::Running);
        assert!(q.cancel(a));
        wait_for(&q, a, JobStatus::Cancelled);
        assert_eq!(q.get(a).unwrap().error, None);
    }

    #[test]
    fn finished_jobs_can_be_cleared_and_active_ones_are_kept() {
        let (release, wait) = mpsc::channel::<()>();
        let wait = Mutex::new(wait);
        let q = ExportQueue::new(
            move |n: u32, _: &JobContext| {
                if n == 2 {
                    let _ = wait.lock().unwrap().recv();
                }
                Ok(())
            },
            |_| {},
        );
        let a = q.add(1, meta("/a")).unwrap();
        let b = q.add(2, meta("/b")).unwrap();
        wait_for(&q, a, JobStatus::Done);
        wait_for(&q, b, JobStatus::Running);
        q.clear_finished();
        assert_eq!(q.list().iter().map(|j| j.id).collect::<Vec<_>>(), [b]);
        assert_eq!(q.active_count(), 1);
        release.send(()).unwrap();
    }

    #[test]
    fn every_change_is_announced() {
        let seen = Arc::new(Mutex::new(Vec::<JobStatus>::new()));
        let sink = seen.clone();
        let q = ExportQueue::new(
            |_: u32, _: &JobContext| Ok(()),
            move |jobs| {
                if let Some(j) = jobs.last() {
                    sink.lock().unwrap().push(j.status);
                }
            },
        );
        let a = q.add(1, meta("/a")).unwrap();
        wait_for(&q, a, JobStatus::Done);
        std::thread::sleep(Duration::from_millis(20));
        let seen = seen.lock().unwrap();
        assert_eq!(seen.first(), Some(&JobStatus::Queued));
        assert!(seen.contains(&JobStatus::Running) && seen.last() == Some(&JobStatus::Done));
    }
}
