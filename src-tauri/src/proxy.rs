use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Mutex, Notify};

struct BucketState {
    tokens: f64,
    last_tick: Instant,
}

pub struct ProxyController {
    port: AtomicU16,
    rate_limit_kbps: AtomicU64,
    bucket: Mutex<BucketState>,
    notify: Notify,
    shutdown_tx: Mutex<Option<watch::Sender<bool>>>,
}

impl ProxyController {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            port: AtomicU16::new(0),
            rate_limit_kbps: AtomicU64::new(0),
            bucket: Mutex::new(BucketState {
                tokens: 0.0,
                last_tick: Instant::now(),
            }),
            notify: Notify::new(),
            shutdown_tx: Mutex::new(None),
        })
    }

    pub fn get_port(&self) -> u16 {
        self.port.load(Ordering::Relaxed)
    }

    pub async fn set_global_rate(&self, rate_kbps: u64) {
        self.rate_limit_kbps.store(rate_kbps, Ordering::Relaxed);
        {
            let mut b = self.bucket.lock().await;
            b.tokens = 0.0;
            b.last_tick = Instant::now();
        }
        self.notify.notify_waiters();
    }

    pub async fn start(self: &Arc<Self>) -> Result<u16, std::io::Error> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let local_port = listener.local_addr()?.port();
        self.port.store(local_port, Ordering::Relaxed);

        let (tx, mut rx) = watch::channel(false);
        *self.shutdown_tx.lock().await = Some(tx);

        let controller = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = rx.changed() => {
                        if *rx.borrow() {
                            break;
                        }
                    }
                    accepted = listener.accept() => {
                        match accepted {
                            Ok((socket, _)) => {
                                let ctrl = Arc::clone(&controller);
                                tokio::spawn(async move {
                                    handle_client(socket, ctrl).await;
                                });
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        });

        Ok(local_port)
    }

    pub async fn stop(&self) {
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(true);
        }
        self.port.store(0, Ordering::Relaxed);
    }

    /// Consumes up to `requested` bytes from the global token bucket.
    /// Returns how many bytes may be sent immediately (unlimited returns `requested`).
    async fn acquire_bytes(&self, requested: usize) -> usize {
        loop {
            let rate = self.rate_limit_kbps.load(Ordering::Relaxed);
            if rate == 0 {
                return requested;
            }

            let bytes_per_sec = (rate as f64) * 1024.0;
            {
                let mut b = self.bucket.lock().await;
                let now = Instant::now();
                let dt = now.duration_since(b.last_tick).as_secs_f64();
                b.last_tick = now;

                b.tokens = (b.tokens + bytes_per_sec * dt).min(bytes_per_sec);

                if b.tokens >= 1.0 {
                    let allowed = (b.tokens.floor() as usize).min(requested).max(1);
                    b.tokens -= allowed as f64;
                    return allowed;
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(20)) => {}
                _ = self.notify.notified() => {}
            }
        }
    }
}

async fn handle_client(mut client: TcpStream, ctrl: Arc<ProxyController>) {
    let mut header_buf = vec![0u8; 4096];
    let n = match client.read(&mut header_buf).await {
        Ok(0) | Err(_) => return,
        Ok(n) => n,
    };

    let req = String::from_utf8_lossy(&header_buf[..n]);
    let first_line = match req.lines().next() {
        Some(l) => l,
        None => return,
    };

    if !first_line.starts_with("CONNECT ") {
        let _ = client
            .write_all(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
            .await;
        return;
    }

    let target_url = match first_line.split_whitespace().nth(1) {
        Some(u) if !u.is_empty() => u,
        _ => return,
    };

    let (hostname, target_port) = match target_url.rfind(':') {
        Some(idx) if idx > 0 => {
            let host = &target_url[..idx];
            let port = target_url[idx + 1..].parse::<u16>().unwrap_or(443);
            (host, port)
        }
        _ => (target_url, 443),
    };

    if hostname.is_empty() {
        let _ = client.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        return;
    }

    let proxy_port = ctrl.get_port();
    if (hostname.eq_ignore_ascii_case("localhost") || hostname.starts_with("127."))
        && target_port == proxy_port
    {
        let _ = client.write_all(b"HTTP/1.1 403 Forbidden\r\n\r\n").await;
        return;
    }

    let addr = format!("{}:{}", hostname, target_port);
    let target = match TcpStream::connect(&addr).await {
        Ok(s) => s,
        Err(_) => {
            let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n").await;
            return;
        }
    };

    if client
        .write_all(b"HTTP/1.1 200 Connection Established\r\nProxy-agent: BitKit-Internal-Proxy\r\n\r\n")
        .await
        .is_err()
    {
        return;
    }

    let (mut client_read, mut client_write) = client.into_split();
    let (mut target_read, mut target_write) = target.into_split();

    let c2t = tokio::spawn(async move {
        let _ = tokio::io::copy(&mut client_read, &mut target_write).await;
        let _ = target_write.shutdown().await;
    });

    let t2c = tokio::spawn(async move {
        let mut buf = vec![0u8; 32 * 1024];
        loop {
            let read_n = match target_read.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            let mut offset = 0;
            while offset < read_n {
                let allowed = ctrl.acquire_bytes(read_n - offset).await;
                if client_write
                    .write_all(&buf[offset..offset + allowed])
                    .await
                    .is_err()
                {
                    return;
                }
                offset += allowed;
            }
        }
        let _ = client_write.shutdown().await;
    });

    let _ = tokio::join!(c2t, t2c);
}

#[cfg(test)]
mod tests {
    use super::ProxyController;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    #[tokio::test]
    async fn proxy_rejects_non_connect_and_self_loop() {
        let proxy = ProxyController::new();
        let port = proxy.start().await.expect("proxy start");
        assert!(port > 0);

        // Non-CONNECT -> 405
        let mut s1 = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s1.write_all(b"GET / HTTP/1.1\r\nHost: example.com\r\n\r\n")
            .await
            .unwrap();
        let mut buf = [0u8; 256];
        let n = s1.read(&mut buf).await.unwrap();
        assert!(String::from_utf8_lossy(&buf[..n]).contains("405 Method Not Allowed"));

        // Loopback to self -> 403
        let mut s2 = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let req = format!("CONNECT 127.0.0.1:{} HTTP/1.1\r\n\r\n", port);
        s2.write_all(req.as_bytes()).await.unwrap();
        let n2 = s2.read(&mut buf).await.unwrap();
        assert!(String::from_utf8_lossy(&buf[..n2]).contains("403 Forbidden"));

        proxy.stop().await;
    }
}
