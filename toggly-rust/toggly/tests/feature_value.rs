//! Catalog `valueType` + typed flag getters (OPS-2102): `get_string_value` /
//! `get_number_value` / `get_json_value` / `get_datetime_value`.
use toggly::{EvalContext, TogglyClient, TogglyConfig};
use wiremock::matchers::{method, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn feature_value_defs_body() -> serde_json::Value {
    serde_json::json!([
        {
            "featureKey": "greeting",
            "filters": [{"name": "AlwaysOn"}],
            "valueType": "string",
            "value": "hello"
        },
        {
            "featureKey": "limit",
            "filters": [{"name": "AlwaysOn"}],
            "valueType": "number",
            "value": 42
        },
        {
            "featureKey": "config",
            "filters": [{"name": "AlwaysOn"}],
            "valueType": "json",
            "value": {"nested": {"flag": true}}
        },
        {
            "featureKey": "launch-at",
            "filters": [{"name": "AlwaysOn"}],
            "valueType": "datetime",
            "value": "2026-06-01T00:00:00Z"
        },
        {
            "featureKey": "disabled-greeting",
            "filters": [],
            "valueType": "string",
            "value": "hello"
        },
        {
            "featureKey": "legacy-greeting",
            "filters": [{"name": "AlwaysOn"}],
            "value": "hello"
        }
    ])
}

async fn client_with_feature_values() -> TogglyClient {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path_regex(r"^/definitions/"))
        .respond_with(ResponseTemplate::new(200).set_body_json(feature_value_defs_body()))
        .mount(&server)
        .await;

    TogglyClient::new(
        TogglyConfig::builder()
            .app_key("test-app")
            .environment("Production")
            .definitions_url(format!("{}/", server.uri()))
            .use_signed_definitions(false)
            .disable_background_refresh(true)
            .enable_live_updates(false)
            .enable_usage_tracking(false)
            .enable_metrics(false)
            .disable_entity_context_registration(true)
            .build(),
    )
    .await
    .expect("client")
}

#[tokio::test]
async fn get_string_value_matches_declared_type() {
    let client = client_with_feature_values().await;
    let value = client
        .get_string_value("greeting", EvalContext::default())
        .await;
    assert_eq!(value, Some("hello".to_string()));
    client.close().await;
}

#[tokio::test]
async fn get_string_value_soft_nulls_on_declared_mismatch() {
    let client = client_with_feature_values().await;
    let value = client
        .get_string_value("limit", EvalContext::default())
        .await;
    assert_eq!(value, None);
    client.close().await;
}

#[tokio::test]
async fn get_number_value() {
    let client = client_with_feature_values().await;
    let value = client
        .get_number_value("limit", EvalContext::default())
        .await;
    assert_eq!(value, Some(42.0));
    client.close().await;
}

#[tokio::test]
async fn get_json_value() {
    let client = client_with_feature_values().await;
    let value = client
        .get_json_value("config", EvalContext::default())
        .await;
    assert_eq!(value, Some(serde_json::json!({"nested": {"flag": true}})));
    client.close().await;
}

#[tokio::test]
async fn get_datetime_value_parses_iso8601() {
    let client = client_with_feature_values().await;
    let value = client
        .get_datetime_value("launch-at", EvalContext::default())
        .await
        .expect("parsed datetime");
    assert_eq!(value.format("%Y-%m-%d").to_string(), "2026-06-01");
    client.close().await;
}

#[tokio::test]
async fn get_string_value_soft_nulls_on_disabled_flag() {
    let client = client_with_feature_values().await;
    let value = client
        .get_string_value("disabled-greeting", EvalContext::default())
        .await;
    assert_eq!(value, None);
    client.close().await;
}

#[tokio::test]
async fn typed_getters_soft_null_on_missing_feature() {
    let client = client_with_feature_values().await;
    assert_eq!(
        client
            .get_string_value("unknown", EvalContext::default())
            .await,
        None
    );
    assert_eq!(
        client
            .get_number_value("unknown", EvalContext::default())
            .await,
        None
    );
    assert_eq!(
        client
            .get_json_value("unknown", EvalContext::default())
            .await,
        None
    );
    assert_eq!(
        client
            .get_datetime_value("unknown", EvalContext::default())
            .await,
        None
    );
    client.close().await;
}

#[tokio::test]
async fn get_string_value_decodes_legacy_catalog_without_declared_value_type() {
    let client = client_with_feature_values().await;
    let value = client
        .get_string_value("legacy-greeting", EvalContext::default())
        .await;
    assert_eq!(value, Some("hello".to_string()));
    client.close().await;
}
