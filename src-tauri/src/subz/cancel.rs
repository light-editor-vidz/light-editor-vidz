use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use anyhow::Result;

use crate::subz::errors::coded;

static CANCELLED: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicUsize = AtomicUsize::new(0);
/// Changes whenever a run starts or ends: a pending release of the models only fires if nothing
/// happened in between.
static ACTIVITY: AtomicUsize = AtomicUsize::new(0);

/// A cancellation asked while nothing runs counts for the run that starts within this delay (the
/// request can overtake the command it was meant for); after that it is stale and dropped.
const PENDING_GRACE: std::time::Duration = std::time::Duration::from_secs(3);
/// Operation ids remembered while waiting for their run to start.
const MAX_PENDING_IDS: usize = 16;

/// Who runs and what was asked, under one lock so that a request and a start cannot miss each
/// other.
#[derive(Default)]
struct State {
    running: usize,
    /// Anonymous request made while idle, with its time.
    anonymous: Option<std::time::Instant>,
    /// Ids cancelled before their run started.
    pending_ids: Vec<String>,
    /// Ids of the runs in progress.
    active_ids: Vec<String>,
}

impl State {
    /// `true` when the flag must be raised right now.
    fn request(&mut self, id: Option<&str>, now: std::time::Instant) -> bool {
        match id {
            Some(id) if self.active_ids.iter().any(|a| a == id) => true,
            Some(id) => {
                if self.pending_ids.len() >= MAX_PENDING_IDS {
                    self.pending_ids.remove(0);
                }
                self.pending_ids.push(id.to_string());
                false
            }
            None if self.running > 0 => true,
            None => {
                self.anonymous = Some(now);
                false
            }
        }
    }

    /// Registers a run; the result tells `(first run, cancelled before it started)`.
    fn enter(&mut self, id: Option<&str>, now: std::time::Instant) -> (bool, bool) {
        let first = self.running == 0;
        self.running += 1;
        let mut cancelled = false;
        if let Some(id) = id {
            if let Some(i) = self.pending_ids.iter().position(|p| p == id) {
                self.pending_ids.remove(i);
                cancelled = true;
            }
            self.active_ids.push(id.to_string());
        } else if first {
            cancelled = self
                .anonymous
                .is_some_and(|at| now.duration_since(at) <= PENDING_GRACE);
        }
        if first {
            self.anonymous = None;
        }
        (first, cancelled)
    }

    /// `true` when it was the last run.
    fn exit(&mut self, id: Option<&str>) -> bool {
        if let Some(i) = id.and_then(|id| self.active_ids.iter().position(|a| a == id)) {
            self.active_ids.remove(i);
        }
        self.running = self.running.saturating_sub(1);
        self.running == 0
    }
}

static STATE: Mutex<State> = Mutex::new(State {
    running: 0,
    anonymous: None,
    pending_ids: Vec::new(),
    active_ids: Vec::new(),
});

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// The id of the oldest run in progress that has one: progress events carry it so that the
/// frontend can tell its own operation from another tab's.
pub fn current_operation_id() -> Option<String> {
    state().active_ids.first().cloned()
}

/// How long the models stay in memory (whisper: hundreds of MB, NLLB: ~900 MB) after the last run.
const IDLE_RELEASE: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// Held for the length of a transcription or a translation, so that quitting the app can
/// wait for it to clean up (temporary audio, ffmpeg) instead of cutting it short.
pub struct Busy(Option<String>);

impl Busy {
    /// A run without operation id (see [`Busy::enter_for`]).
    pub fn enter() -> Busy {
        Self::enter_for(None)
    }

    /// The first run to start clears a stale cancellation, but one requested for it before it
    /// started (by its `operation_id`, or anonymously within a few seconds) is kept: it used to
    /// be wiped here. A run that starts while another is active leaves the flag alone.
    pub fn enter_for(operation_id: Option<String>) -> Busy {
        ACTIVITY.fetch_add(1, Ordering::SeqCst);
        let mut st = state();
        let (first, cancelled) = st.enter(operation_id.as_deref(), std::time::Instant::now());
        RUNNING.fetch_add(1, Ordering::SeqCst);
        if first || cancelled {
            CANCELLED.store(cancelled, Ordering::SeqCst);
        }
        drop(st);
        Busy(operation_id)
    }
}

impl Drop for Busy {
    fn drop(&mut self) {
        let last = state().exit(self.0.as_deref());
        RUNNING.fetch_sub(1, Ordering::SeqCst);
        if last {
            schedule_idle_release(IDLE_RELEASE);
        }
    }
}

/// Frees the local models once nothing used them for `after` (they were kept for the whole session).
fn schedule_idle_release(after: std::time::Duration) {
    let seen = ACTIVITY.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(after);
        if ACTIVITY.load(Ordering::SeqCst) == seen && !is_busy() {
            crate::subz::pipeline::stt::local_whisper::release_cache();
            crate::subz::pipeline::translate::local_nllb::release_cache();
        }
    });
}

pub fn is_busy() -> bool {
    RUNNING.load(Ordering::SeqCst) > 0
}

/// Clears the flag (tests; a run clears a stale cancellation itself, see [`Busy::enter`]).
#[cfg(test)]
pub fn reset() {
    CANCELLED.store(false, Ordering::SeqCst);
}

/// Asks the run(s) in progress to stop. `operation_id` names the run (it may not have started
/// yet: the request is then kept for it); without one, a request made while idle applies to the
/// run that starts within [`PENDING_GRACE`].
pub fn request_for(operation_id: Option<&str>) {
    let mut st = state();
    if st.request(operation_id, std::time::Instant::now()) {
        CANCELLED.store(true, Ordering::SeqCst);
    }
}

pub fn request() {
    request_for(None);
}

/// The flag itself, for work done outside the pipeline (the mix of a whole project).
pub fn flag() -> &'static AtomicBool {
    &CANCELLED
}

pub fn is_cancelled() -> bool {
    CANCELLED.load(Ordering::SeqCst)
}

/// `Err` once the user asked to stop; engines call it between units of work.
pub fn check() -> Result<()> {
    if is_cancelled() {
        Err(coded("cancelled", "cancelled by the user"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_busy_guard_is_counted_until_it_is_dropped() {
        let guard = Busy::enter();
        assert!(is_busy());

        drop(guard);

        // Other tests may hold a guard at the same time: only the count matters here.
        let again = Busy::enter();
        assert!(is_busy());
        drop(again);
    }

    // One test: the flag is process-wide, so separate tests would race.
    #[test]
    fn a_request_is_seen_until_the_next_reset() {
        let _running = Busy::enter();
        reset();
        assert!(check().is_ok());

        request();
        let err = check().unwrap_err();
        assert!(is_cancelled());
        assert!(err.to_string().contains("cancelled"));

        reset();
        assert!(check().is_ok());
    }

    #[test]
    fn a_cancellation_asked_before_the_start_is_kept_for_that_run() {
        let now = std::time::Instant::now();
        let mut st = State::default();
        assert!(!st.request(Some("op1"), now));
        // Another run is not concerned, the awaited one starts cancelled.
        assert_eq!(st.enter(Some("other"), now), (true, false));
        assert_eq!(st.enter(Some("op1"), now), (false, true));
        // Consumed: a second run with that id is not cancelled.
        st.exit(Some("op1"));
        assert_eq!(st.enter(Some("op1"), now), (false, false));
    }

    #[test]
    fn an_anonymous_request_while_idle_expires() {
        let now = std::time::Instant::now();
        let mut st = State::default();
        st.request(None, now);
        assert_eq!(st.enter(None, now), (true, true));
        st.exit(None);
        st.request(None, now);
        let late = now + PENDING_GRACE + std::time::Duration::from_secs(1);
        assert_eq!(st.enter(None, late), (true, false));
    }

    #[test]
    fn a_request_for_an_active_run_raises_the_flag_and_a_second_run_keeps_it() {
        let now = std::time::Instant::now();
        let mut st = State::default();
        st.enter(Some("a"), now);
        assert!(st.request(Some("a"), now));
        assert!(st.request(None, now));
        // A concurrent start is not "first": it must not clear the flag.
        assert_eq!(st.enter(Some("b"), now), (false, false));
        assert!(!st.exit(Some("a")));
        assert!(st.exit(Some("b")));
    }
}
