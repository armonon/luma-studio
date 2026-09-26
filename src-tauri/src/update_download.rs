//! The stock updater buffers an unbounded response. Keep its Minisign wire
//! format and installer, but admit every artifact chunk before retaining it.
use base64::Engine;
use minisign_verify::{PublicKey, Signature};

pub const MAX_UPDATE_BYTES: usize = 512 * 1024 * 1024;

struct BoundedDownload { bytes: Vec<u8>, limit: usize }
impl BoundedDownload {
    fn new(length: Option<u64>, limit: usize) -> Result<Self, String> {
        if length.is_some_and(|size| size > limit as u64) { return Err("Signed update exceeds the 512 MiB download limit".into()); }
        Ok(Self { bytes: Vec::new(), limit })
    }
    fn append(&mut self, chunk: &[u8]) -> Result<(), String> {
        let end = self.bytes.len().checked_add(chunk.len()).filter(|end| *end <= self.limit)
            .ok_or("Signed update exceeds the 512 MiB download limit")?;
        if end > self.bytes.capacity() {
            let capacity = self.bytes.capacity().max(64 * 1024).saturating_mul(2).max(end).min(self.limit);
            self.bytes.try_reserve_exact(capacity - self.bytes.len()).map_err(|_| "Not enough memory for the verified update; save and restart before retrying")?;
        }
        self.bytes.extend_from_slice(chunk);
        Ok(())
    }
}

fn signature_material(key: &str, signature: &str) -> Result<(PublicKey, Signature), String> {
    let decode = |value: &str| -> Result<String, String> {
        if value.is_empty() || value.len() > 16 * 1024 { return Err("Invalid update signature metadata size".into()); }
        let bytes = base64::engine::general_purpose::STANDARD.decode(value).map_err(|_| "Invalid update signature encoding")?;
        String::from_utf8(bytes).map_err(|_| "Invalid update signature text".into())
    };
    let key = PublicKey::decode(&decode(key)?).map_err(|_| "Invalid updater public key")?;
    let signature = Signature::decode(&decode(signature)?).map_err(|_| "Invalid update signature")?;
    Ok((key, signature))
}

fn admitted_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some() && url.username().is_empty() && url.password().is_none() && url.fragment().is_none()
}

fn update_client() -> reqwest::ClientBuilder {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
}

pub async fn download(update: &tauri_plugin_updater::Update, key: &str) -> Result<Vec<u8>, String> {
    if !admitted_url(&update.download_url) { return Err("Signed updates require a credential-free HTTPS download URL".into()); }
    let (key, signature) = signature_material(key, &update.signature)?;
    let mut client = update_client().timeout(std::time::Duration::from_secs(180))
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !admitted_url(attempt.url()) { attempt.error("Unsafe or excessive update redirect") }
            else { attempt.follow() }
        }));
    if update.no_proxy { client = client.no_proxy(); }
    else if let Some(proxy) = &update.proxy { client = client.proxy(reqwest::Proxy::all(proxy.as_str()).map_err(|_| "Invalid updater proxy")?); }
    let response = client.build().map_err(|error| format!("Update transport unavailable: {error}"))?
        .get(update.download_url.clone()).headers(update.headers.clone())
        .header(reqwest::header::ACCEPT, "application/octet-stream").header(reqwest::header::USER_AGENT, "Luma signed updater")
        .send().await.map_err(|error| format!("Update download failed: {error}"))?;
    let bytes = read_response(response, MAX_UPDATE_BYTES).await?;
    // Same public key/signature decoding and legacy flag as Tauri 2.10.1.
    key.verify(&bytes, &signature, true).map_err(|_| "Update signature verification failed; nothing was installed")?;
    Ok(bytes)
}

async fn read_response(response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    let mut response = response.error_for_status().map_err(|error| format!("Update download refused: {error}"))?;
    let expected = response.content_length();
    let mut buffer = BoundedDownload::new(expected, limit)?;
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("Update download interrupted: {error}"))? { buffer.append(&chunk)?; }
    if buffer.bytes.is_empty() || expected.is_some_and(|length| length != buffer.bytes.len() as u64) { return Err("Update download is empty or incomplete".into()); }
    Ok(buffer.bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declared_and_chunked_downloads_are_admitted_before_retention() {
        assert!(BoundedDownload::new(Some(u64::MAX), 8).is_err());
        for declared in [None, Some(8)] {
            let mut buffer = BoundedDownload::new(declared, 8).unwrap();
            buffer.append(&[1; 4]).unwrap(); buffer.append(&[2; 4]).unwrap();
            assert!(buffer.append(&[3]).is_err());
            assert_eq!(buffer.bytes, vec![1, 1, 1, 1, 2, 2, 2, 2]);
            assert!(buffer.bytes.capacity() <= 8);
        }
    }

    #[test]
    fn download_destinations_cannot_downgrade_transport_or_carry_credentials() {
        for value in ["http://example.test/update", "https://name:secret@example.test/update", "https://example.test/update#fragment", "file:///tmp/update"] {
            assert!(!admitted_url(&reqwest::Url::parse(value).unwrap()));
        }
        assert!(admitted_url(&reqwest::Url::parse("https://example.test/update?version=1").unwrap()));
    }

    #[test]
    fn real_signature_vector_rejects_changed_and_truncated_artifacts() {
        // Public verification vector from minisign-verify's MIT-licensed tests.
        let public = "untrusted comment: test public key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        let signature = "untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==";
        let encode = |text: &str| base64::engine::general_purpose::STANDARD.encode(text);
        let (key, sig) = signature_material(&encode(public), &encode(signature)).unwrap();
        assert!(key.verify(b"test", &sig, true).is_ok());
        assert!(key.verify(b"Test", &sig, true).is_err());
        assert!(key.verify(b"tes", &sig, true).is_err());
        assert!(signature_material("garbage", &encode(signature)).is_err());
        assert!(signature_material(&encode(public), &"x".repeat(16385)).is_err());
    }

    #[test]
    fn real_transport_faults_never_produce_an_installable_buffer() {
        use std::io::{Read, Write};
        for (wire, expected) in [
            ("HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest", Some(b"test".as_slice())),
            ("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\ntest", Some(b"test".as_slice())),
            ("HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", None),
            ("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", None),
            ("HTTP/1.1 200 OK\r\nContent-Length: 99\r\nConnection: close\r\n\r\ntest", None),
            ("HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\ntest", None),
            ("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n6\r\n123456\r\n4\r\n7890\r\n0\r\n\r\n", None),
        ] {
            // HTTP exists only in this private loopback transport test. The
            // production entry point independently refuses non-HTTPS URLs.
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            listener.set_nonblocking(true).unwrap();
            let server = std::thread::spawn(move || -> std::io::Result<()> {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
                while std::time::Instant::now() < deadline {
                    if let Ok((mut stream, _)) = listener.accept() {
                        // macOS can inherit O_NONBLOCK from the listener.
                        stream.set_nonblocking(false)?;
                        stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
                        // A TCP read is not an HTTP request boundary. Closing
                        // with unread request bytes can reset the socket and
                        // turn the nominal success fixture into a flaky error.
                        let mut request = Vec::with_capacity(1024);
                        while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                            let mut chunk = [0u8; 1024];
                            let count = stream.read(&mut chunk)?;
                            if count == 0 || request.len() + count > 8192 {
                                return Err(std::io::Error::other("Incomplete or oversized fixture request"));
                            }
                            request.extend_from_slice(&chunk[..count]);
                        }
                        stream.write_all(wire.as_bytes())?;
                        return Ok(());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Err(std::io::Error::other("Fixture client never connected"))
            });
            let result = tauri::async_runtime::block_on(async {
                let response = update_client().no_proxy().timeout(std::time::Duration::from_secs(2)).build().unwrap()
                    .get(format!("http://{address}/fixture")).send().await.map_err(|error| error.to_string())?;
                read_response(response, 8).await
            });
            server.join().unwrap().expect("Loopback fixture must serve the intended response");
            match expected { Some(bytes) => assert_eq!(result.unwrap(), bytes), None => assert!(result.is_err(), "{wire}") }
        }
    }
}
