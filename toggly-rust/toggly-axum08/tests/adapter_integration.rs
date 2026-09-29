use axum::{
    body::{to_bytes, Body},
    extract::{Extension, State},
    http::{Request, StatusCode},
    routing::get,
    Router,
};
use std::sync::Arc;
use toggly::{EvalContext, TogglyClient, TogglyConfig};
use toggly_axum08::{Feature, FeatureEnabled, TogglyExtractor, TogglyLayer, TogglyState};
use tower05::ServiceExt;
use wiremock::matchers::{method, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn client_with_definitions(server: &MockServer) -> Arc<TogglyClient> {
    Mock::given(method("GET"))
        .and(path_regex(r"^/definitions/"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"featureKey": "on", "filters": [{"name": "AlwaysOn"}]},
            {"featureKey": "off", "filters": []},
            {"featureKey": "targeted", "filters": [{
                "name": "Targeting", "parameters": {"Audience": ["alice", "custom"]}
            }]}
        ])))
        .mount(server)
        .await;

    Arc::new(
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
        .expect("client"),
    )
}

async fn send(app: Router, path: &str, headers: &[(&str, &str)]) -> (StatusCode, String) {
    let mut request = Request::builder().uri(path);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = app
        .oneshot(request.body(Body::empty()).expect("request"))
        .await
        .expect("router response");
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");
    (
        status,
        String::from_utf8(body.to_vec()).expect("UTF-8 body"),
    )
}

async fn feature_handler(feature: Feature) -> String {
    format!(
        "{}:{}:{}:{}",
        feature.context().identity.as_deref().unwrap_or("anonymous"),
        feature.is_enabled("targeted").await,
        feature.is_disabled("off").await,
        feature.client().config().app_key
    )
}

async fn client_handler(client: TogglyExtractor) -> &'static str {
    if client
        .is_enabled("on", EvalContext::default())
        .await
        .expect("feature evaluation")
    {
        "enabled"
    } else {
        "disabled"
    }
}

async fn state_handler(State(state): State<TogglyState>) -> &'static str {
    if state.is_enabled("on").await && state.is_disabled("off").await {
        "state-ok"
    } else {
        "state-failed"
    }
}

#[tokio::test]
async fn extractors_use_extensions_and_identity_precedence() {
    let definitions_server = MockServer::start().await;
    let client = client_with_definitions(&definitions_server).await;
    let app = Router::new()
        .route("/feature", get(feature_handler))
        .route("/client", get(client_handler))
        .layer(Extension(Arc::clone(&client)));

    assert_eq!(
        send(
            app.clone(),
            "/feature",
            &[("x-user-id", "alice"), ("x-identity", "other")]
        )
        .await,
        (StatusCode::OK, "alice:true:true:test-app".to_string())
    );
    assert_eq!(
        send(app.clone(), "/feature", &[("x-identity", "custom")]).await,
        (StatusCode::OK, "custom:true:true:test-app".to_string())
    );
    assert_eq!(
        send(app.clone(), "/feature", &[]).await,
        (StatusCode::OK, "anonymous:false:true:test-app".to_string())
    );
    assert_eq!(
        send(app, "/client", &[]).await,
        (StatusCode::OK, "enabled".to_string())
    );
    client.close().await;
}

#[tokio::test]
async fn middleware_checks_enabled_disabled_negated_and_targeted_features() {
    let definitions_server = MockServer::start().await;
    let client = client_with_definitions(&definitions_server).await;
    let app = Router::new()
        .route(
            "/on",
            get(|| async { "on" }).layer(TogglyLayer::require("on")),
        )
        .route(
            "/off",
            get(|| async { "off" }).layer(TogglyLayer::require("off")),
        )
        .route(
            "/deny",
            get(|| async { "deny" }).layer(TogglyLayer::deny("on")),
        )
        .route(
            "/negate",
            get(|| async { "negate" }).layer(TogglyLayer::require("on").negate()),
        )
        .route(
            "/targeted",
            get(|| async { "targeted" }).layer(TogglyLayer::require("targeted")),
        )
        .route(
            "/custom",
            get(|| async { "custom" })
                .layer(TogglyLayer::require("targeted").identity_header("x-account-id")),
        )
        .layer(Extension(Arc::clone(&client)));

    assert_eq!(send(app.clone(), "/on", &[]).await.0, StatusCode::OK);
    assert_eq!(
        send(app.clone(), "/off", &[]).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(app.clone(), "/deny", &[]).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(app.clone(), "/negate", &[]).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(app.clone(), "/targeted", &[("x-user-id", "alice")])
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        send(app.clone(), "/targeted", &[("x-identity", "custom")])
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        send(app.clone(), "/targeted", &[("x-user-id", "other")])
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(app.clone(), "/custom", &[("x-account-id", "custom")])
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        send(
            app,
            "/custom",
            &[("x-account-id", "other"), ("x-user-id", "alice")]
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    client.close().await;
}

#[tokio::test]
async fn missing_client_passes_middleware_but_rejects_extractors() {
    let app = Router::new()
        .route(
            "/gated",
            get(|| async { "allowed" }).layer(TogglyLayer::require("on")),
        )
        .route("/feature", get(feature_handler))
        .route("/client", get(client_handler));

    assert_eq!(
        send(app.clone(), "/gated", &[]).await,
        (StatusCode::OK, "allowed".to_string())
    );
    assert_eq!(
        send(app.clone(), "/feature", &[]).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        send(app, "/client", &[]).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
}

#[tokio::test]
async fn state_wrapper_supports_owned_and_shared_clients() {
    let definitions_server = MockServer::start().await;
    let client = client_with_definitions(&definitions_server).await;
    let state = TogglyState::from_arc(Arc::clone(&client));
    assert!(Arc::ptr_eq(&client, &state.client_arc()));
    assert_eq!(state.client().config().app_key, "test-app");
    assert_eq!(state.config().app_key, "test-app");
    assert!(
        state
            .is_enabled_with_context("targeted", EvalContext::with_identity("alice"))
            .await
    );
    assert!(
        !state
            .is_enabled_with_context("targeted", EvalContext::default())
            .await
    );

    let app = Router::new()
        .route("/state", get(state_handler))
        .with_state(state);
    assert_eq!(
        send(app, "/state", &[]).await,
        (StatusCode::OK, "state-ok".to_string())
    );
    client.close().await;

    let owned_client = client_with_definitions(&definitions_server).await;
    let owned_client = Arc::try_unwrap(owned_client).unwrap_or_else(|_| panic!("sole owner"));
    let owned_state = TogglyState::new(owned_client);
    assert_eq!(owned_state.client().config().app_key, "test-app");
    owned_state.client().close().await;
}

#[test]
fn feature_enabled_exposes_checked_key() {
    let feature = FeatureEnabled {
        feature_key: "on".to_string(),
    };
    assert_eq!(feature.feature_key(), "on");
}
