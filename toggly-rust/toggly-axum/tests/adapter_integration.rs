use axum::{
    extract::{Extension, State},
    http::{header::HeaderName, HeaderValue, StatusCode},
    routing::get,
    Router,
};
use axum_test::TestServer;
use std::sync::Arc;
use toggly::{EvalContext, TogglyClient, TogglyConfig};
use toggly_axum::{Feature, TogglyExtractor, TogglyLayer, TogglyState};
use wiremock::matchers::{method, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn client_with_definitions(
    server: &MockServer,
    definitions: serde_json::Value,
) -> TogglyClient {
    Mock::given(method("GET"))
        .and(path_regex(r"^/definitions/"))
        .respond_with(ResponseTemplate::new(200).set_body_json(definitions))
        .mount(server)
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

fn definitions(enabled: bool) -> serde_json::Value {
    serde_json::json!([{
        "featureKey": "beta",
        "filters": if enabled {
            serde_json::json!([{"name": "AlwaysOn"}])
        } else {
            serde_json::json!([])
        }
    }])
}

async fn feature_handler(feature: Feature) -> String {
    format!(
        "{}:{}:{}:{}",
        feature.context().identity.as_deref().unwrap_or("anonymous"),
        feature.is_enabled("beta").await,
        feature.is_disabled("missing").await,
        feature.client().config().app_key
    )
}

async fn client_handler(client: TogglyExtractor) -> &'static str {
    if client
        .is_enabled("beta", EvalContext::default())
        .await
        .unwrap()
    {
        "enabled"
    } else {
        "disabled"
    }
}

async fn state_handler(State(state): State<TogglyState>) -> &'static str {
    if state.is_enabled("beta").await && state.is_disabled("missing").await {
        "state-ok"
    } else {
        "state-failed"
    }
}

#[tokio::test]
async fn feature_and_client_extractors_use_request_extensions_and_identity_headers() {
    let definitions_server = MockServer::start().await;
    let client = Arc::new(client_with_definitions(&definitions_server, definitions(true)).await);
    let app = Router::new()
        .route("/feature", get(feature_handler))
        .route("/client", get(client_handler))
        .layer(Extension(Arc::clone(&client)));
    let server = TestServer::new(app).expect("test server");

    let feature_response = server
        .get("/feature")
        .add_header(
            HeaderName::from_static("x-user-id"),
            HeaderValue::from_static("alice"),
        )
        .await;
    feature_response.assert_status_ok();
    assert_eq!(feature_response.text(), "alice:true:true:test-app");

    let client_response = server.get("/client").await;
    client_response.assert_status_ok();
    assert_eq!(client_response.text(), "enabled");

    let fallback_identity = server
        .get("/feature")
        .add_header(
            HeaderName::from_static("x-identity"),
            HeaderValue::from_static("fallback-user"),
        )
        .await;
    fallback_identity.assert_status_ok();
    assert_eq!(fallback_identity.text(), "fallback-user:true:true:test-app");
    client.close().await;
}

#[tokio::test]
async fn missing_client_allows_the_request_through_and_extractors_reject_without_it() {
    let app = Router::new()
        .route(
            "/gated",
            get(|| async { "allowed" }).layer(TogglyLayer::require("beta")),
        )
        .route("/feature", get(feature_handler))
        .route("/client", get(client_handler));
    let server = TestServer::new(app).expect("test server");

    let allowed = server.get("/gated").await;
    allowed.assert_status_ok();
    assert_eq!(allowed.text(), "allowed");
    server
        .get("/feature")
        .await
        .assert_status(StatusCode::INTERNAL_SERVER_ERROR);
    server
        .get("/client")
        .await
        .assert_status(StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn middleware_allows_and_denies_requests_for_enabled_and_disabled_features() {
    let enabled_server = MockServer::start().await;
    let enabled_client =
        Arc::new(client_with_definitions(&enabled_server, definitions(true)).await);
    let enabled_app = Router::new()
        .route(
            "/require",
            get(|| async { "required" }).layer(TogglyLayer::require("beta")),
        )
        .route(
            "/deny",
            get(|| async { "denied" }).layer(TogglyLayer::deny("beta")),
        )
        .layer(Extension(Arc::clone(&enabled_client)));
    let enabled = TestServer::new(enabled_app).expect("test server");
    enabled.get("/require").await.assert_status_ok();
    enabled.get("/deny").await.assert_status_not_found();
    let negated_app = Router::new()
        .route(
            "/negated",
            get(|| async { "negated" }).layer(TogglyLayer::require("beta").negate()),
        )
        .layer(Extension(Arc::clone(&enabled_client)));
    TestServer::new(negated_app)
        .expect("test server")
        .get("/negated")
        .await
        .assert_status_not_found();
    enabled_client.close().await;

    let disabled_server = MockServer::start().await;
    let disabled_client =
        Arc::new(client_with_definitions(&disabled_server, definitions(false)).await);
    let disabled_app = Router::new()
        .route(
            "/require",
            get(|| async { "required" }).layer(TogglyLayer::require("beta")),
        )
        .route(
            "/deny",
            get(|| async { "denied" }).layer(TogglyLayer::deny("beta")),
        )
        .layer(Extension(Arc::clone(&disabled_client)));
    let disabled = TestServer::new(disabled_app).expect("test server");
    disabled.get("/require").await.assert_status_not_found();
    disabled.get("/deny").await.assert_status_ok();
    disabled_client.close().await;
}

#[tokio::test]
async fn custom_identity_header_and_state_wrapper_evaluate_features() {
    let definitions_server = MockServer::start().await;
    let client = client_with_definitions(&definitions_server, definitions(true)).await;
    let client = Arc::new(client);

    let header_app = Router::new()
        .route(
            "/gated",
            get(|| async { "custom-header" })
                .layer(TogglyLayer::require("beta").identity_header("x-account-id")),
        )
        .layer(Extension(Arc::clone(&client)));
    let header_server = TestServer::new(header_app).expect("test server");
    header_server
        .get("/gated")
        .add_header(
            HeaderName::from_static("x-account-id"),
            HeaderValue::from_static("account-42"),
        )
        .await
        .assert_status_ok();

    let state = TogglyState::from_arc(Arc::clone(&client));
    assert!(Arc::ptr_eq(&client, &state.client_arc()));
    assert_eq!(state.client().config().app_key, "test-app");
    assert!(
        state
            .is_enabled_with_context("beta", EvalContext::with_identity("alice"))
            .await
    );

    let state_server = TestServer::new(
        Router::new()
            .route("/state", get(state_handler))
            .with_state(state),
    )
    .expect("test server");
    let response = state_server.get("/state").await;
    response.assert_status_ok();
    assert_eq!(response.text(), "state-ok");
    client.close().await;

    let owned_client = client_with_definitions(&definitions_server, definitions(true)).await;
    let owned_state = TogglyState::new(owned_client);
    assert_eq!(owned_state.config().app_key, "test-app");
    owned_state.client().close().await;
}
