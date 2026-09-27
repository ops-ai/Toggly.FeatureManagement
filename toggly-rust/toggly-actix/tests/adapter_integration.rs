use actix_web::{test, web, App, HttpResponse};
use toggly::{EvalContext, TogglyClient, TogglyConfig};
use toggly_actix::{Feature, FeatureGuard, TogglyData, TogglyMiddleware};
use wiremock::matchers::{method, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn client_with_definitions(server: &MockServer) -> TogglyClient {
    Mock::given(method("GET"))
        .and(path_regex(r"^/definitions/"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
            {"featureKey": "enabled", "filters": [{"name": "AlwaysOn"}]},
            {"featureKey": "disabled", "filters": []}
        ])))
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

async fn toggly_data_handler(toggly: TogglyData) -> HttpResponse {
    let enabled = toggly
        .is_enabled("enabled", EvalContext::default())
        .await
        .expect("enabled evaluation");
    let disabled = toggly
        .is_disabled("disabled", EvalContext::default())
        .await
        .expect("disabled evaluation");
    assert!(toggly.client().is_defined_sync("enabled"));
    assert!(toggly.is_defined_sync("disabled"));
    HttpResponse::Ok().body(format!("{enabled}:{disabled}"))
}

async fn feature_context_handler(feature: Feature) -> HttpResponse {
    let identity = feature.context().identity.as_deref().unwrap_or("anonymous");
    let enabled = feature.is_enabled("enabled").await;
    let disabled = feature.is_disabled("disabled").await;
    HttpResponse::Ok().body(format!("{identity}:{enabled}:{disabled}"))
}

#[actix_rt::test]
async fn extractors_use_configured_client_and_request_identity() {
    let server = MockServer::start().await;
    let data = web::Data::new(client_with_definitions(&server).await);
    let app = test::init_service(
        App::new()
            .app_data(data.clone())
            .route("/data", web::get().to(toggly_data_handler))
            .route("/feature", web::get().to(feature_context_handler)),
    )
    .await;

    let data_response =
        test::call_service(&app, test::TestRequest::get().uri("/data").to_request()).await;
    assert!(data_response.status().is_success());
    assert_eq!(test::read_body(data_response).await, "true:true");

    let user_id_response = test::call_service(
        &app,
        test::TestRequest::get()
            .uri("/feature")
            .insert_header(("X-User-Id", "primary"))
            .insert_header(("X-Identity", "fallback"))
            .to_request(),
    )
    .await;
    assert_eq!(test::read_body(user_id_response).await, "primary:true:true");

    let identity_response = test::call_service(
        &app,
        test::TestRequest::get()
            .uri("/feature")
            .insert_header(("X-Identity", "fallback"))
            .to_request(),
    )
    .await;
    assert_eq!(
        test::read_body(identity_response).await,
        "fallback:true:true"
    );

    let anonymous_response =
        test::call_service(&app, test::TestRequest::get().uri("/feature").to_request()).await;
    assert_eq!(
        test::read_body(anonymous_response).await,
        "anonymous:true:true"
    );

    drop(app);
    data.get_ref().close().await;
}

#[actix_rt::test]
async fn middleware_passes_through_without_a_gate_or_client() {
    let ungated = test::init_service(App::new().wrap(TogglyMiddleware::new()).route(
        "/",
        web::get().to(|| async { HttpResponse::Ok().body("ok") }),
    ))
    .await;
    let ungated_response =
        test::call_service(&ungated, test::TestRequest::get().uri("/").to_request()).await;
    assert!(ungated_response.status().is_success());

    let no_client = test::init_service(
        App::new()
            .wrap(TogglyMiddleware::with_feature("enabled"))
            .route(
                "/",
                web::get().to(|| async { HttpResponse::Ok().body("ok") }),
            ),
    )
    .await;
    let no_client_response =
        test::call_service(&no_client, test::TestRequest::get().uri("/").to_request()).await;
    assert!(no_client_response.status().is_success());
}

#[actix_rt::test]
async fn middleware_enforces_enabled_disabled_and_negated_gates() {
    let server = MockServer::start().await;
    let data = web::Data::new(client_with_definitions(&server).await);
    let gated = test::init_service(
        App::new()
            .app_data(data.clone())
            .wrap(TogglyMiddleware::with_feature("enabled").identity_header("X-Customer"))
            .route(
                "/",
                web::get().to(|| async { HttpResponse::Ok().body("ok") }),
            ),
    )
    .await;
    let enabled = test::call_service(
        &gated,
        test::TestRequest::get()
            .uri("/")
            .insert_header(("X-Customer", "customer-1"))
            .to_request(),
    )
    .await;
    assert!(enabled.status().is_success());

    let disabled = test::init_service(
        App::new()
            .app_data(data.clone())
            .wrap(TogglyMiddleware::with_feature("disabled"))
            .route(
                "/",
                web::get().to(|| async { HttpResponse::Ok().body("ok") }),
            ),
    )
    .await;
    let disabled_response =
        test::call_service(&disabled, test::TestRequest::get().uri("/").to_request()).await;
    assert_eq!(
        disabled_response.status(),
        actix_web::http::StatusCode::NOT_FOUND
    );

    let negated = test::init_service(
        App::new()
            .app_data(data.clone())
            .wrap(TogglyMiddleware::with_feature("disabled").negate())
            .route(
                "/",
                web::get().to(|| async { HttpResponse::Ok().body("ok") }),
            ),
    )
    .await;
    let negated_response =
        test::call_service(&negated, test::TestRequest::get().uri("/").to_request()).await;
    assert!(negated_response.status().is_success());

    drop(gated);
    drop(disabled);
    drop(negated);
    data.get_ref().close().await;
}

#[actix_rt::test]
async fn feature_guard_allows_known_features_and_negates_unknown_features() {
    let server = MockServer::start().await;
    let data = web::Data::new(client_with_definitions(&server).await);
    let app = test::init_service(
        App::new()
            .app_data(data.clone())
            .route(
                "/known",
                web::get()
                    .guard(FeatureGuard::new("enabled"))
                    .to(|| async { HttpResponse::Ok().finish() }),
            )
            .route(
                "/unknown",
                web::get()
                    .guard(FeatureGuard::new("unknown"))
                    .to(|| async { HttpResponse::Ok().finish() }),
            )
            .route(
                "/negated",
                web::get()
                    .guard(FeatureGuard::disabled("unknown"))
                    .to(|| async { HttpResponse::Ok().finish() }),
            )
            .route(
                "/double-negated",
                web::get()
                    .guard(FeatureGuard::disabled("unknown").negate())
                    .to(|| async { HttpResponse::Ok().finish() }),
            ),
    )
    .await;

    assert!(
        test::call_service(&app, test::TestRequest::get().uri("/known").to_request())
            .await
            .status()
            .is_success()
    );
    assert_eq!(
        test::call_service(&app, test::TestRequest::get().uri("/unknown").to_request())
            .await
            .status(),
        actix_web::http::StatusCode::NOT_FOUND
    );
    assert!(
        test::call_service(&app, test::TestRequest::get().uri("/negated").to_request())
            .await
            .status()
            .is_success()
    );
    assert_eq!(
        test::call_service(
            &app,
            test::TestRequest::get().uri("/double-negated").to_request()
        )
        .await
        .status(),
        actix_web::http::StatusCode::NOT_FOUND
    );

    drop(app);
    data.get_ref().close().await;
}
