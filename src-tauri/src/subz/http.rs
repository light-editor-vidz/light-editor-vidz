use std::sync::OnceLock;
use std::time::Duration;

use anyhow::Result;
use reqwest::blocking::{Client, Request, RequestBuilder, Response};
use reqwest::{Method, StatusCode};

use crate::subz::cancel;
use crate::subz::errors::coded;

/// Long on purpose (but a request is cut off after 15 minutes, not half an hour, and a request
/// that keeps failing stops retrying after `TOTAL_BUDGET`): uploading an hour of audio or translating hundreds of lines is
/// slower than reqwest's 30 s default for blocking clients. The connect timeout still
/// fails fast on a dead network.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Once this much time went into one request, no further attempt is started: four attempts on a
/// blocked connection would otherwise add up to two hours.
const TOTAL_BUDGET: Duration = Duration::from_secs(40 * 60);

/// Bound for the short exchanges (status polling, deletion, lookups): their answer does not
/// depend on the size of the audio, so a connection silent for this long is blocked. reqwest's
/// blocking client has no per-read timeout, so this is a total timeout set on those requests only;
/// the long ones (upload, transcription of a chunk) keep `REQUEST_TIMEOUT`, and are still
/// abandoned at once when the user cancels.
const SHORT_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// A file sent as a request body that stops (read error) as soon as the user cancels: an upload
/// abandoned by its thread would otherwise carry on, and be billed, until its end.
pub struct CancellableReader<R>(R);

impl<R: std::io::Read> std::io::Read for CancellableReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if cancel::is_cancelled() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "cancelled by the user",
            ));
        }
        self.0.read(buf)
    }
}

pub fn cancellable_file_body(file: std::fs::File) -> Result<reqwest::blocking::Body> {
    let len = file.metadata()?.len();
    Ok(reqwest::blocking::Body::sized(CancellableReader(file), len))
}

/// One client for every cloud engine (shared connection pool and TLS state).
pub fn client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .tcp_keepalive(Duration::from_secs(30))
            .user_agent(concat!("light-gen-subz/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("building the HTTP client")
    })
}

/// Error code for an HTTP status, when the frontend has a dedicated message for it.
pub fn code_for_status(status: StatusCode) -> Option<&'static str> {
    match status.as_u16() {
        401 | 403 => Some("api_key_invalid"),
        413 => Some("file_too_large"),
        429 | 456 => Some("quota_exceeded"),
        500..=599 => Some("provider_unavailable"),
        _ => None,
    }
}

/// Keeps the useful start of a provider's error body without flooding the UI.
pub fn shorten(body: &str) -> String {
    let flat: String = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > 300 {
        let cut: String = flat.chars().take(300).collect();
        format!("{cut}…")
    } else {
        flat
    }
}

/// Attempts per request: the first one plus three retries.
const MAX_ATTEMPTS: u32 = 4;
/// Longest wait honoured from a `Retry-After` header.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(60);

fn backoff_base() -> Duration {
    if cfg!(test) {
        Duration::from_millis(2)
    } else {
        Duration::from_secs(1)
    }
}

/// Statuses worth another try: the provider is busy or briefly down.
pub fn is_retryable_status(status: StatusCode) -> bool {
    matches!(status.as_u16(), 408 | 425 | 429 | 500 | 502 | 503 | 504)
}

fn is_idempotent(method: &Method) -> bool {
    matches!(
        *method,
        Method::GET | Method::HEAD | Method::PUT | Method::DELETE | Method::OPTIONS
    )
}

/// Whether a request sent with `method` may be sent again after `status`. A POST is retried only
/// when the provider says it did not process it (429 too many requests, 503 unavailable, both
/// with `Retry-After` honoured): after a 500, 502 or 504 the work may have been done, and a
/// second send would be billed twice (or create a second AssemblyAI job).
pub fn may_retry(method: &Method, status: StatusCode) -> bool {
    if is_idempotent(method) {
        is_retryable_status(status)
    } else {
        matches!(status.as_u16(), 429 | 503)
    }
}

/// Wait before attempt `attempt + 1`: `Retry-After` when the provider gave one, otherwise
/// 1 s, 2 s, 4 s… with up to 25 % of jitter.
pub fn retry_delay(attempt: u32, retry_after: Option<Duration>) -> Duration {
    if let Some(wait) = retry_after {
        return wait.min(MAX_RETRY_AFTER);
    }
    let base = backoff_base() * 2u32.pow(attempt.saturating_sub(1));
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    base + base.mul_f64(f64::from(nanos % 1000) / 4000.0)
}

fn parse_retry_after(value: &str) -> Option<Duration> {
    value.trim().parse::<u64>().ok().map(Duration::from_secs)
}

/// Sleeps in small steps so a cancellation is noticed within 100 ms.
fn sleep_cancellable(total: Duration) -> Result<()> {
    let end = std::time::Instant::now() + total;
    while std::time::Instant::now() < end {
        cancel::check()?;
        std::thread::sleep(Duration::from_millis(100).min(end - std::time::Instant::now()));
    }
    cancel::check()
}

enum Outcome {
    Success(Response),
    Status {
        status: StatusCode,
        body: String,
        retry_after: Option<Duration>,
    },
    Transport(reqwest::Error),
}

/// One request, sent from a helper thread so a cancellation is honoured while it is in
/// flight: the thread is abandoned and ends with the request or its timeout.
fn attempt(request: Request) -> Result<Outcome> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let outcome = match client().execute(request) {
            Ok(response) if response.status().is_success() => Outcome::Success(response),
            Ok(response) => {
                let status = response.status();
                let retry_after = response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(parse_retry_after);
                Outcome::Status {
                    status,
                    body: response.text().unwrap_or_default(),
                    retry_after,
                }
            }
            Err(e) => Outcome::Transport(e.without_url()),
        };
        let _ = tx.send(outcome);
    });
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(outcome) => return Ok(outcome),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => cancel::check()?,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                anyhow::bail!("the request thread ended unexpectedly")
            }
        }
    }
}

fn error_chain(e: &dyn std::error::Error) -> String {
    let mut text = e.to_string();
    let mut source = e.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

/// Sends the request, retrying (idempotent calls; a POST only when the provider refused it
/// untouched, see [`may_retry`]) a busy or unreachable provider with a growing delay, and
/// turns a non-2xx answer into an error that carries the provider's own explanation
/// (`error_for_status` throws the body away). `make` builds a fresh request for every
/// attempt: a streamed body cannot be sent twice. The URL is stripped from transport
/// errors, as it may contain a credential. A cancellation interrupts the wait and the
/// request in flight.
pub fn send_checked(make: impl Fn() -> Result<RequestBuilder>, provider: &str) -> Result<Response> {
    let mut tries = 0;
    let started = std::time::Instant::now();
    loop {
        cancel::check()?;
        tries += 1;
        let last = tries >= MAX_ATTEMPTS || started.elapsed() >= TOTAL_BUDGET;
        let mut request = make()?
            .build()
            .map_err(|e| anyhow::anyhow!("building request to {provider}: {}", e.without_url()))?;
        let method = request.method().clone();
        if matches!(method, Method::GET | Method::HEAD | Method::DELETE) {
            request.timeout_mut().get_or_insert(SHORT_REQUEST_TIMEOUT);
        }
        match attempt(request)? {
            Outcome::Success(response) => return Ok(response),
            Outcome::Status {
                status,
                body,
                retry_after,
            } => {
                if !last && may_retry(&method, status) {
                    sleep_cancellable(retry_delay(tries, retry_after))?;
                    continue;
                }
                let message = format!("{provider} returned HTTP {status}: {}", shorten(&body));
                return Err(match code_for_status(status) {
                    Some(code) => coded(code, message),
                    None => anyhow::anyhow!(message),
                });
            }
            Outcome::Transport(e) => {
                // Seulement quand la requête n'est pas partie (connexion refusée) : après un délai dépassé,
                // le fournisseur a pu traiter l'envoi, et un nouvel essai facturerait deux fois (ou
                // créerait un second travail AssemblyAI).
                let retryable = e.is_connect();
                if !last && retryable {
                    sleep_cancellable(retry_delay(tries, None))?;
                    continue;
                }
                let message = format!("sending request to {provider}: {}", error_chain(&e));
                return Err(if e.is_connect() || e.is_timeout() {
                    coded("network_unreachable", message)
                } else {
                    anyhow::anyhow!(message)
                });
            }
        }
    }
}

#[cfg(test)]
mod budget_tests {
    use super::*;

    #[test]
    fn a_blocked_connection_cannot_hold_the_app_for_hours() {
        // Quatre tentatives à 30 min : 2 h figé. Désormais borné par le budget total.
        assert!(REQUEST_TIMEOUT <= Duration::from_secs(15 * 60));
        assert!(TOTAL_BUDGET + REQUEST_TIMEOUT < Duration::from_secs(60 * 60));
    }
}

#[cfg(test)]
pub mod testserver {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    #[derive(Debug, Clone)]
    pub struct Recorded {
        pub request_line: String,
        pub headers: String,
        pub body: Vec<u8>,
    }

    pub struct Mock {
        pub url: String,
        pub requests: Arc<Mutex<Vec<Recorded>>>,
    }

    /// Serves the canned `(status, body)` answers in order, one per connection, then stops.
    pub fn serve(answers: Vec<(u16, String)>) -> Mock {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        thread::spawn(move || {
            for (status, body) in answers {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut buf = Vec::new();
                let mut tmp = [0u8; 8192];
                let header_end = loop {
                    let n = stream.read(&mut tmp).unwrap_or(0);
                    if n == 0 {
                        break None;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        break Some(pos);
                    }
                };
                let Some(end) = header_end else { continue };
                let head = String::from_utf8_lossy(&buf[..end]).to_string();
                let length = head
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                    })
                    .unwrap_or(0);
                let mut req_body = buf[end + 4..].to_vec();
                while req_body.len() < length {
                    let n = stream.read(&mut tmp).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    req_body.extend_from_slice(&tmp[..n]);
                }
                let (request_line, headers) = head.split_once("\r\n").unwrap_or((&head, ""));
                seen.lock().unwrap().push(Recorded {
                    request_line: request_line.to_string(),
                    headers: headers.to_string(),
                    body: req_body,
                });
                let reply = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(reply.as_bytes());
            }
        });
        Mock { url, requests }
    }
}

#[cfg(test)]
mod tests {
    use super::testserver::serve;
    use super::*;

    #[test]
    fn auth_failures_carry_a_dedicated_code() {
        assert_eq!(
            code_for_status(StatusCode::UNAUTHORIZED),
            Some("api_key_invalid")
        );
        assert_eq!(
            code_for_status(StatusCode::FORBIDDEN),
            Some("api_key_invalid")
        );
    }

    #[test]
    fn size_and_quota_failures_carry_a_dedicated_code() {
        assert_eq!(
            code_for_status(StatusCode::PAYLOAD_TOO_LARGE),
            Some("file_too_large")
        );
        assert_eq!(
            code_for_status(StatusCode::TOO_MANY_REQUESTS),
            Some("quota_exceeded")
        );
        assert_eq!(
            code_for_status(StatusCode::from_u16(456).unwrap()),
            Some("quota_exceeded")
        );
        assert_eq!(code_for_status(StatusCode::BAD_REQUEST), None);
    }

    #[test]
    fn a_long_body_is_shortened() {
        let out = shorten(&"x".repeat(1000));

        assert_eq!(out.chars().count(), 301);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn whitespace_in_a_body_is_flattened() {
        assert_eq!(shorten("a\n  b\t c"), "a b c");
    }

    #[test]
    fn a_success_answer_is_passed_through() {
        let mock = serve(vec![(200, "{\"ok\":true}".into())]);

        let response = send_checked(|| Ok(client().get(&mock.url)), "Test").unwrap();

        assert_eq!(response.text().unwrap(), "{\"ok\":true}");
    }

    #[test]
    fn an_error_answer_keeps_the_provider_explanation() {
        let mock = serve(vec![(401, "{\"message\":\"bad key\"}".into())]);

        let err = send_checked(|| Ok(client().get(&mock.url)), "Test").unwrap_err();
        let out = crate::subz::errors::CommandError::from(err);

        assert_eq!(out.code, Some("api_key_invalid"));
        assert!(out.message.contains("bad key"), "{}", out.message);
        assert!(out.message.contains("401"), "{}", out.message);
    }

    #[test]
    fn a_transport_error_does_not_leak_the_url() {
        let err = send_checked(
            || Ok(client().get("http://127.0.0.1:1/?key=SECRET")),
            "Test",
        )
        .unwrap_err();

        assert!(!format!("{err:#}").contains("SECRET"));
    }

    #[test]
    fn a_busy_provider_is_retried_until_it_answers() {
        let mock = serve(vec![
            (503, "busy".into()),
            (429, "slow down".into()),
            (200, "{\"ok\":true}".into()),
        ]);

        let response = send_checked(|| Ok(client().get(&mock.url)), "Test").unwrap();

        assert_eq!(response.text().unwrap(), "{\"ok\":true}");
        assert_eq!(mock.requests.lock().unwrap().len(), 3);
    }

    #[test]
    fn a_provider_that_stays_down_is_given_up_on_with_its_code() {
        let mock = serve(vec![(503, "down".into()); 4]);

        let err = send_checked(|| Ok(client().get(&mock.url)), "Test").unwrap_err();
        let out = crate::subz::errors::CommandError::from(err);

        assert_eq!(out.code, Some("provider_unavailable"));
        assert_eq!(mock.requests.lock().unwrap().len(), 4);
    }

    #[test]
    fn a_post_is_not_resent_after_a_server_error_but_is_after_a_refusal() {
        let mock = serve(vec![(500, "boom".into()), (200, "{}".into())]);
        assert!(send_checked(|| Ok(client().post(&mock.url).body("x")), "Test").is_err());
        assert_eq!(mock.requests.lock().unwrap().len(), 1);

        let mock = serve(vec![(429, "slow".into()), (200, "{}".into())]);
        assert!(send_checked(|| Ok(client().post(&mock.url).body("x")), "Test").is_ok());
        assert_eq!(mock.requests.lock().unwrap().len(), 2);

        assert!(may_retry(&Method::GET, StatusCode::BAD_GATEWAY));
        assert!(!may_retry(&Method::POST, StatusCode::BAD_GATEWAY));
    }

    #[test]
    fn an_upload_body_stops_reading_once_cancelled() {
        use std::io::Read;
        let mut reader = CancellableReader(std::io::Cursor::new(vec![1u8; 10]));
        let mut buf = [0u8; 4];
        let _running = cancel::Busy::enter();
        cancel::reset();
        assert_eq!(reader.read(&mut buf).unwrap(), 4);
        cancel::request();
        assert!(reader.read(&mut buf).is_err());
        cancel::reset();
    }

    #[test]
    fn a_refused_key_is_not_retried() {
        let mock = serve(vec![(401, "no".into()), (200, "{}".into())]);

        assert!(send_checked(|| Ok(client().get(&mock.url)), "Test").is_err());
        assert_eq!(mock.requests.lock().unwrap().len(), 1);
    }

    #[test]
    fn an_unreachable_network_has_its_own_code() {
        let err = send_checked(|| Ok(client().get("http://127.0.0.1:1/")), "Test").unwrap_err();

        assert_eq!(
            crate::subz::errors::CommandError::from(err).code,
            Some("network_unreachable")
        );
    }

    #[test]
    fn retry_after_wins_over_the_backoff_but_is_capped() {
        assert_eq!(
            retry_delay(1, Some(Duration::from_secs(7))),
            Duration::from_secs(7)
        );
        assert_eq!(
            retry_delay(1, Some(Duration::from_secs(3600))),
            MAX_RETRY_AFTER
        );
        assert!(retry_delay(3, None) > retry_delay(1, None));
    }

    #[test]
    fn only_transient_statuses_are_retryable() {
        for code in [408, 425, 429, 500, 502, 503, 504] {
            assert!(
                is_retryable_status(StatusCode::from_u16(code).unwrap()),
                "{code}"
            );
        }
        for code in [400, 401, 403, 404, 413, 456] {
            assert!(
                !is_retryable_status(StatusCode::from_u16(code).unwrap()),
                "{code}"
            );
        }
    }
}
