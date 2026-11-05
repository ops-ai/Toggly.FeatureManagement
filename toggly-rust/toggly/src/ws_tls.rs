//! Explicit rustls config for live-update WebSockets.
//!
//! With the `telemetry` feature, both `ring` (via tonic `tls-ring`) and
//! `aws-lc-rs` (via reqwest `rustls`) are compiled into `rustls` 0.23. In that
//! state, `ClientConfig::builder()` / `tokio_tungstenite::connect_async` panic
//! unless a process-level default crypto provider has already been installed.
//!
//! This crate is a library: it must not call
//! [`rustls::crypto::CryptoProvider::install_default`] (that would override the
//! host application's choice). Live-update connects therefore build a
//! [`ClientConfig`] that names `aws-lc-rs` explicitly — the same provider
//! reqwest already uses for HTTPS.

use std::sync::Arc;

use rustls::ClientConfig;
use rustls::RootCertStore;
use tokio_tungstenite::Connector;

/// TLS connector for `wss://` live-update connects.
pub(crate) fn live_updates_tls_connector() -> Connector {
    Connector::Rustls(live_updates_rustls_client_config())
}

/// rustls client config with an explicit `aws-lc-rs` crypto provider and
/// webpki root store.
pub(crate) fn live_updates_rustls_client_config() -> Arc<ClientConfig> {
    let mut roots = RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    live_updates_rustls_client_config_with_roots(roots)
}

/// Same as [`live_updates_rustls_client_config`] but with a caller-supplied
/// root store (used by tests that mint a self-signed server cert).
pub(crate) fn live_updates_rustls_client_config_with_roots(
    roots: RootCertStore,
) -> Arc<ClientConfig> {
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    Arc::new(
        ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("rustls safe default protocol versions")
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
    use tokio::net::TcpListener;
    use tokio_rustls::TlsAcceptor;
    use tokio_tungstenite::{accept_async, connect_async_tls_with_config};

    /// Seer MEDIUM precondition: telemetry pulls `ring` while reqwest pulls
    /// `aws-lc-rs`, so the default rustls builder cannot pick a provider.
    #[cfg(feature = "telemetry")]
    #[test]
    fn default_client_config_builder_panics_with_dual_crypto_providers() {
        let panicked = std::panic::catch_unwind(|| {
            let _ = ClientConfig::builder();
        })
        .is_err();
        assert!(
            panicked,
            "ClientConfig::builder() must panic when both ring and aws-lc-rs \
             are compiled in and no process default is installed"
        );
    }

    #[test]
    fn named_aws_lc_client_config_builds_without_process_default() {
        // Must not panic even when both ring and aws-lc-rs are linked.
        let _config = live_updates_rustls_client_config();
    }

    /// Opens a real `wss://` connection while both crypto providers are linked
    /// (`telemetry` → ring, reqwest → aws-lc-rs), using the named-provider
    /// connector — the path that used to panic via `connect_async`.
    #[cfg(feature = "telemetry")]
    #[tokio::test]
    async fn wss_connect_with_named_provider_succeeds_under_dual_crypto_providers() {
        // Reaffirm the dual-provider trap is present for this binary.
        assert!(
            std::panic::catch_unwind(|| {
                let _ = ClientConfig::builder();
            })
            .is_err(),
            "test requires both rustls crypto providers to be compiled in"
        );

        let (cert_der, key_der) = test_cert_and_key();
        let mut roots = RootCertStore::empty();
        roots
            .add(cert_der.clone())
            .expect("add test cert to root store");
        let client_config = live_updates_rustls_client_config_with_roots(roots);

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let addr = listener.local_addr().expect("local addr");
        let acceptor = test_tls_acceptor(cert_der, key_der);

        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.expect("accept");
            let tls = acceptor.accept(tcp).await.expect("tls accept");
            let mut ws = accept_async(tls).await.expect("ws accept");
            let msg = ws.next().await.expect("client message").expect("ok");
            assert!(msg.is_text());
            ws.send(tokio_tungstenite::tungstenite::Message::Text("pong".into()))
                .await
                .expect("send pong");
        });

        let url = format!("wss://{addr}/");
        let (mut ws, _response) = connect_async_tls_with_config(
            url.as_str(),
            None,
            false,
            Some(Connector::Rustls(client_config)),
        )
        .await
        .expect("wss connect with named aws-lc-rs provider must not panic");

        ws.send(tokio_tungstenite::tungstenite::Message::Text("ping".into()))
            .await
            .expect("send ping");
        let reply = ws.next().await.expect("server reply").expect("ok");
        assert_eq!(reply.to_text().expect("text"), "pong");

        server.await.expect("server task");
    }

    fn test_cert_and_key() -> (CertificateDer<'static>, PrivateKeyDer<'static>) {
        let certified = rcgen::generate_simple_self_signed(vec![
            "localhost".to_string(),
            "127.0.0.1".to_string(),
        ])
        .expect("self-signed test cert");
        let cert_der = CertificateDer::from(certified.cert.der().to_vec());
        let key_der = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            certified.signing_key.serialize_der(),
        ));
        (cert_der, key_der)
    }

    fn test_tls_acceptor(
        cert_der: CertificateDer<'static>,
        key_der: PrivateKeyDer<'static>,
    ) -> TlsAcceptor {
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let server_config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("server protocols")
            .with_no_client_auth()
            .with_single_cert(vec![cert_der], key_der)
            .expect("server cert");
        TlsAcceptor::from(Arc::new(server_config))
    }
}
