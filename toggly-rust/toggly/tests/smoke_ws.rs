use toggly::provider::DefinitionsProvider;
use toggly::TogglyConfig;

#[tokio::test]
async fn smoke_websocket_connection() {
    let app_key = match std::env::var("TOGGLY_SMOKE_APP_KEY_BACKEND") {
        Ok(v) if !v.is_empty() => v,
        _ => return,
    };

    let config = TogglyConfig::builder()
        .app_key(app_key)
        .environment("Production")
        .definitions_url("https://definitions.toggly.io/")
        .enable_live_updates(true)
        .disable_background_refresh(false)
        .use_signed_definitions(false)
        .build();

    let mut provider = DefinitionsProvider::new(config).expect("Failed to create provider");
    provider
        .initialize()
        .await
        .expect("Failed to initialize provider");

    // Verify definitions were loaded
    assert!(
        !provider.is_empty(),
        "Provider should have definitions after init"
    );
    assert!(provider.contains("FlagOn"), "FlagOn should be defined");
    assert!(provider.contains("FlagOff"), "FlagOff should be defined");

    // Wait for the SDK's built-in WebSocket to connect
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    loop {
        if provider.is_ws_connected() {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("SDK WebSocket should be connected within 15 seconds");
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    assert!(
        provider.is_ws_connected(),
        "WebSocket should still be connected"
    );

    // Verify definitions are still available after WebSocket connects
    assert!(
        provider.contains("FlagOn"),
        "FlagOn should still be defined"
    );
    assert!(
        provider.contains("FlagOff"),
        "FlagOff should still be defined"
    );

    provider.shutdown();
}
