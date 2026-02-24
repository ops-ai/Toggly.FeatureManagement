use futures_util::StreamExt;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[tokio::test]
async fn smoke_websocket_connection() {
    let app_key = match std::env::var("TOGGLY_SMOKE_APP_KEY_BACKEND") {
        Ok(v) if !v.is_empty() => v,
        _ => return,
    };

    let url = format!("wss://definitions.toggly.io/{}/ws", app_key);
    let (mut ws_stream, _) =
        tokio::time::timeout(std::time::Duration::from_secs(10), connect_async(&url))
            .await
            .expect("WebSocket connect timed out")
            .expect("WebSocket connect failed");

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    loop {
        let msg = tokio::time::timeout_at(deadline, ws_stream.next())
            .await
            .expect("WebSocket read timed out")
            .expect("WebSocket stream ended")
            .expect("WebSocket read error");

        if let Message::Text(text) = msg {
            let parsed: serde_json::Value = serde_json::from_str(&text).expect("Invalid JSON");
            if parsed["type"] == "ping" {
                continue;
            }
            assert!(
                parsed["type"] == "definitions" || parsed["type"] == "evaluated",
                "Expected type=definitions or evaluated, got {}",
                parsed["type"]
            );
            assert!(parsed.get("timestamp").is_some(), "Missing timestamp field");
            break;
        } else {
            panic!("Expected text message, got {:?}", msg);
        }
    }
}
