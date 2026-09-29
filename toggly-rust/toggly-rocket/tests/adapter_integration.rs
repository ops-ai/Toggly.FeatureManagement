use rocket::{
    fairing::Fairing,
    get,
    http::{Header, Status},
    local::asynchronous::Client,
    routes,
};
use toggly::{TogglyClient, TogglyConfig};
use toggly_rocket::{Feature, TogglyFairing};
use wiremock::matchers::{method, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[get("/feature")]
async fn feature(feature: Feature<'_>) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        feature.context().identity.as_deref().unwrap_or("anonymous"),
        feature.is_enabled("beta").await,
        feature.is_disabled("missing").await,
        feature.is_enabled("").await,
        feature.client().config().app_key,
    )
}

async fn definitions_server() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path_regex(r"^/definitions/"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                "featureKey": "beta",
                "filters": [{"name": "AlwaysOn"}]
            }])),
        )
        .mount(&server)
        .await;
    server
}

fn config(server: &MockServer) -> TogglyConfig {
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
        .build()
}

#[tokio::test]
async fn feature_guard_uses_managed_client_and_request_identity() {
    let server = definitions_server().await;
    let client = TogglyClient::new(config(&server)).await.expect("client");
    let rocket = Client::tracked(rocket::build().manage(client).mount("/", routes![feature]))
        .await
        .expect("rocket");

    let anonymous = rocket.get("/feature").dispatch().await;
    assert_eq!(anonymous.status(), Status::Ok);
    assert_eq!(
        anonymous.into_string().await.as_deref(),
        Some("anonymous:true:true:false:test-app")
    );

    let fallback = rocket
        .get("/feature")
        .header(Header::new("X-Identity", "fallback-user"))
        .dispatch()
        .await;
    assert_eq!(
        fallback.into_string().await.as_deref(),
        Some("fallback-user:true:true:false:test-app")
    );

    let primary = rocket
        .get("/feature")
        .header(Header::new("X-Identity", "fallback-user"))
        .header(Header::new("X-User-Id", "primary-user"))
        .dispatch()
        .await;
    assert_eq!(
        primary.into_string().await.as_deref(),
        Some("primary-user:true:true:false:test-app")
    );
}

#[tokio::test]
async fn feature_guard_fails_closed_without_managed_client() {
    let rocket = Client::tracked(rocket::build().mount("/", routes![feature]))
        .await
        .expect("rocket");
    assert_eq!(
        rocket.get("/feature").dispatch().await.status(),
        Status::InternalServerError
    );
}

#[tokio::test]
async fn fairing_installs_client_for_feature_guard() {
    let server = definitions_server().await;
    let rocket = Client::tracked(
        rocket::build()
            .attach(TogglyFairing::from_config(config(&server)))
            .mount("/", routes![feature]),
    )
    .await
    .expect("fairing should initialize");
    let response = rocket.get("/feature").dispatch().await;
    assert_eq!(response.status(), Status::Ok);
    assert_eq!(
        response.into_string().await.as_deref(),
        Some("anonymous:true:true:false:test-app")
    );
}

#[tokio::test]
async fn fairing_rejects_invalid_client_config() {
    let invalid = TogglyConfig::builder()
        .app_key("")
        .environment("Production")
        .build();
    let result = TogglyFairing::from_config(invalid)
        .on_ignite(rocket::build())
        .await;
    assert!(result.is_err(), "invalid client config must abort ignition");
}
