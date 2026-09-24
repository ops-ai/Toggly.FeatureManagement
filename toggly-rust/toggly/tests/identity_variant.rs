//! Ambient / config identity precedence for catalog-local get_variant.
use toggly::{EvalContext, TogglyClient, TogglyConfig};
use wiremock::matchers::{method, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn checkout_flow_body() -> serde_json::Value {
    serde_json::json!([{
        "featureKey": "checkout-flow",
        "filters": [{"name": "AlwaysOn"}],
        "variants": [
            {"name": "A", "configurationValue": {"color": "blue"}},
            {"name": "B", "configurationValue": {"color": "green"}}
        ],
        "allocation": {
            "defaultWhenEnabled": "B",
            "user": [{"variant": "A", "users": ["alice"]}]
        }
    }])
}

async fn client_against(server: &MockServer, identity: Option<&str>) -> TogglyClient {
    Mock::given(method("GET"))
        .and(path_regex(r"^/definitions/"))
        .respond_with(ResponseTemplate::new(200).set_body_json(checkout_flow_body()))
        .mount(server)
        .await;

    let mut builder = TogglyConfig::builder()
        .app_key("test-app")
        .environment("Production")
        .definitions_url(format!("{}/", server.uri()))
        .use_signed_definitions(false)
        .disable_background_refresh(true)
        .enable_live_updates(false)
        .enable_usage_tracking(false)
        .enable_metrics(false)
        .disable_entity_context_registration(true);
    if let Some(id) = identity {
        builder = builder.identity(id);
    }
    TogglyClient::new(builder.build()).await.expect("client")
}

#[tokio::test]
async fn get_variant_uses_config_identity() {
    let server = MockServer::start().await;
    let client = client_against(&server, Some("alice")).await;

    let assignment = client
        .get_variant("checkout-flow", EvalContext::default())
        .await
        .unwrap();
    assert_eq!(assignment.variant_name.as_deref(), Some("A"));
    client.close().await;
}

#[tokio::test]
async fn get_variant_set_identity_overrides_config() {
    let server = MockServer::start().await;
    let client = client_against(&server, Some("carol")).await;
    client.set_identity("alice");

    let assignment = client
        .get_variant("checkout-flow", EvalContext::default())
        .await
        .unwrap();
    assert_eq!(assignment.variant_name.as_deref(), Some("A"));
    client.close().await;
}

#[tokio::test]
async fn get_variant_per_call_overrides_client_identity() {
    let server = MockServer::start().await;
    let client = client_against(&server, Some("carol")).await;

    let assignment = client
        .get_variant("checkout-flow", EvalContext::with_identity("alice"))
        .await
        .unwrap();
    assert_eq!(assignment.variant_name.as_deref(), Some("A"));

    // Empty / missing identity still falls back to client (carol → default B).
    let fallback = client
        .get_variant("checkout-flow", EvalContext::default())
        .await
        .unwrap();
    assert_eq!(fallback.variant_name.as_deref(), Some("B"));
    client.close().await;
}

#[tokio::test]
async fn get_variant_empty_identity_uses_default_when_enabled() {
    let server = MockServer::start().await;
    let client = client_against(&server, None).await;

    let assignment = client
        .get_variant("checkout-flow", EvalContext::default())
        .await
        .unwrap();
    assert_eq!(assignment.variant_name.as_deref(), Some("B"));
    client.close().await;
}

#[tokio::test]
async fn get_variant_value_uses_client_identity() {
    let server = MockServer::start().await;
    let client = client_against(&server, Some("alice")).await;

    let value = client
        .get_variant_value("checkout-flow", EvalContext::default())
        .await
        .unwrap();
    assert_eq!(value, Some(serde_json::json!({"color": "blue"})));
    client.close().await;
}

#[tokio::test]
async fn identity_round_trip() {
    let server = MockServer::start().await;
    let client = client_against(&server, Some("start")).await;
    assert_eq!(client.identity().as_deref(), Some("start"));
    client.set_identity("next");
    assert_eq!(client.identity().as_deref(), Some("next"));
    client.clear_identity();
    assert!(client.identity().is_none());
    client.close().await;
}

#[tokio::test]
async fn client_builder_identity_feeds_get_variant() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path_regex(r"^/definitions/"))
        .respond_with(ResponseTemplate::new(200).set_body_json(checkout_flow_body()))
        .mount(&server)
        .await;

    let client = TogglyClient::builder()
        .app_key("test-app")
        .environment("Production")
        .definitions_url(format!("{}/", server.uri()))
        .use_signed_definitions(false)
        .disable_background_refresh(true)
        .enable_live_updates(false)
        .enable_usage_tracking(false)
        .enable_metrics(false)
        .identity("alice")
        .build()
        .await
        .expect("client");

    let assignment = client
        .get_variant("checkout-flow", EvalContext::default())
        .await
        .expect("variant");
    assert_eq!(assignment.variant_name.as_deref(), Some("A"));
    client.close().await;
}
