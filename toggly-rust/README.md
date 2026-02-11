# Toggly Rust SDK

High-performance Rust SDK for [Toggly](https://toggly.io) feature flags and experimentation platform.

[![Crates.io](https://img.shields.io/crates/v/toggly.svg)](https://crates.io/crates/toggly)
[![Documentation](https://docs.rs/toggly/badge.svg)](https://docs.rs/toggly)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/ops-ai/toggly-feature-flags/actions/workflows/rust-ci.yml/badge.svg)](https://github.com/ops-ai/toggly-feature-flags/actions/workflows/rust-ci.yml)

## Features

- **Async-first**: Built on Tokio for efficient async operations
- **Type-safe**: Leverages Rust's type system for compile-time safety
- **Thread-safe**: Safe concurrent access with Arc and DashMap
- **Zero-cost abstractions**: Minimal overhead with idiomatic Rust patterns
- **Framework integrations**: Native support for Actix, Axum, and Rocket
- **Procedural macros**: Declarative feature flag guards
- **In-memory caching**: Built-in caching with configurable TTL
- **WebAssembly support**: Works in browser environments

## Crates

| Crate | Description | Crates.io |
|-------|-------------|-----------|
| `toggly` | Core SDK with minimal dependencies | [![crates.io](https://img.shields.io/crates/v/toggly.svg)](https://crates.io/crates/toggly) |
| `toggly-macros` | Procedural macros for feature flags | [![crates.io](https://img.shields.io/crates/v/toggly-macros.svg)](https://crates.io/crates/toggly-macros) |
| `toggly-actix` | Actix-web integration | [![crates.io](https://img.shields.io/crates/v/toggly-actix.svg)](https://crates.io/crates/toggly-actix) |
| `toggly-axum` | Axum integration | [![crates.io](https://img.shields.io/crates/v/toggly-axum.svg)](https://crates.io/crates/toggly-axum) |
| `toggly-rocket` | Rocket integration | [![crates.io](https://img.shields.io/crates/v/toggly-rocket.svg)](https://crates.io/crates/toggly-rocket) |

## Installation

Add the core crate to your `Cargo.toml`:

```toml
[dependencies]
toggly = "0.1"
```

For framework integrations:

```toml
# Actix-web
toggly-actix = "0.1"

# Axum
toggly-axum = "0.1"

# Rocket
toggly-rocket = "0.1"

# Macros
toggly-macros = "0.1"
```

## Quick Start

### Basic Usage

```rust
use toggly::{TogglyClient, EvalContext};

#[tokio::main]
async fn main() -> Result<(), toggly::Error> {
    // Create client with builder pattern
    let client = TogglyClient::builder()
        .app_key("your-app-key")
        .environment("production")
        .build()
        .await?;

    // Check if a feature is enabled
    let enabled = client.is_enabled("my-feature", EvalContext::default()).await?;

    if enabled {
        println!("Feature is enabled!");
    }

    // Cleanup
    client.close().await;

    Ok(())
}
```

### With User Context

```rust
use toggly::{TogglyClient, EvalContext};
use std::collections::HashMap;

async fn check_feature(client: &TogglyClient, user_id: &str) -> bool {
    let mut traits = HashMap::new();
    traits.insert("plan".to_string(), serde_json::json!("premium"));
    traits.insert("country".to_string(), serde_json::json!("US"));

    let context = EvalContext::builder()
        .identity(user_id)
        .groups(vec!["beta-testers".to_string()])
        .traits(traits)
        .build();

    client.is_enabled("premium-feature", context).await.unwrap_or(false)
}
```

### Feature Gates

Evaluate multiple features with AND/OR logic:

```rust
use toggly::{TogglyClient, EvalContext, Requirement};

async fn check_access(client: &TogglyClient) -> bool {
    // All features must be enabled
    client
        .evaluate_gate(
            &["feature-a", "feature-b"],
            Requirement::All,
            EvalContext::default(),
            false,
        )
        .await
        .unwrap_or(false)
}
```

## Framework Integrations

### Actix-web

```rust
use actix_web::{web, App, HttpServer, HttpResponse};
use toggly::TogglyClient;
use toggly_actix::{TogglyMiddleware, Feature, FeatureEnabled};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let client = TogglyClient::builder()
        .app_key("your-app-key")
        .environment("production")
        .build()
        .await
        .expect("Failed to create client");

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(client.clone()))
            .route("/", web::get().to(index))
            .route("/beta", web::get().to(beta_handler))
    })
    .bind("127.0.0.1:8080")?
    .run()
    .await
}

async fn index(feature: Feature) -> HttpResponse {
    if feature.is_enabled("new-homepage").await {
        HttpResponse::Ok().body("New Homepage")
    } else {
        HttpResponse::Ok().body("Classic Homepage")
    }
}

// Route requires feature to be enabled
async fn beta_handler(_: FeatureEnabled<"beta-features">) -> HttpResponse {
    HttpResponse::Ok().body("Beta Content")
}
```

### Axum

```rust
use axum::{routing::get, Router, Extension};
use std::sync::Arc;
use toggly::TogglyClient;
use toggly_axum::{Feature, TogglyLayer};

#[tokio::main]
async fn main() {
    let client = TogglyClient::builder()
        .app_key("your-app-key")
        .environment("production")
        .build()
        .await
        .expect("Failed to create client");

    let app = Router::new()
        .route("/", get(index))
        .route("/beta", get(beta_handler).layer(TogglyLayer::require("beta-features")))
        .layer(Extension(Arc::new(client)));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn index(feature: Feature) -> &'static str {
    if feature.is_enabled("new-homepage").await {
        "New Homepage"
    } else {
        "Classic Homepage"
    }
}

async fn beta_handler() -> &'static str {
    "Beta Content"
}
```

### Rocket

```rust
use rocket::{get, launch, routes, State};
use toggly::TogglyClient;
use toggly_rocket::{Feature, FeatureEnabled, TogglyFairing};

#[get("/")]
async fn index(feature: Feature<'_>) -> &'static str {
    if feature.is_enabled("new-homepage").await {
        "New Homepage"
    } else {
        "Classic Homepage"
    }
}

#[get("/beta")]
async fn beta(_: FeatureEnabled<"beta-features">) -> &'static str {
    "Beta Content"
}

#[launch]
async fn rocket() -> _ {
    rocket::build()
        .attach(TogglyFairing::new("your-app-key", "production"))
        .mount("/", routes![index, beta])
}
```

## Procedural Macros

Use the `toggly-macros` crate for declarative feature guards:

```rust
use toggly_macros::{feature_flag, FeatureFlags};

#[feature_flag(feature = "premium-feature")]
async fn premium_function() -> String {
    "Premium content".to_string()
}

// Define feature flags as an enum
#[derive(FeatureFlags)]
pub enum Features {
    #[feature(key = "dark-mode")]
    DarkMode,

    #[feature(key = "new-dashboard", default = true)]
    NewDashboard,

    #[feature(key = "beta-features")]
    BetaFeatures,
}

// Usage
async fn example(client: &TogglyClient) {
    let enabled = Features::DarkMode.is_enabled(client, Default::default()).await.unwrap();
}
```

## Configuration Options

```rust
use std::time::Duration;
use toggly::TogglyConfig;

let config = TogglyConfig::builder()
    .app_key("your-app-key")
    .environment("production")
    .base_url("https://app.toggly.io/")
    .definitions_url("https://definitions.toggly.io/")
    .refresh_interval(Duration::from_secs(300))
    .http_timeout(Duration::from_secs(10))
    .cache_ttl(Duration::from_secs(60))
    .cache_max_entries(10_000)
    .enable_undefined_in_dev(true)
    .disable_background_refresh(false)
    .build();
```

## Custom Filter Evaluators

Register custom filter evaluators for advanced targeting:

```rust
use toggly::eval::{Evaluator, Registry};
use toggly::{EvalContext, definitions::FeatureFilter};
use std::sync::Arc;

struct MyCustomEvaluator;

impl Evaluator for MyCustomEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> toggly::Result<bool> {
        // Custom evaluation logic
        Ok(true)
    }
}

// Register with the engine
let registry = Registry::with_defaults();
registry.register("MyCustomFilter", Arc::new(MyCustomEvaluator));
```

## Error Handling

```rust
use toggly::{TogglyClient, EvalContext, Error};

async fn safe_feature_check(client: &TogglyClient) -> bool {
    match client.is_enabled("my-feature", EvalContext::default()).await {
        Ok(enabled) => enabled,
        Err(Error::FeatureNotFound(_)) => {
            tracing::warn!("Feature not found, using default");
            false
        }
        Err(e) => {
            tracing::error!("Feature check failed: {}", e);
            false
        }
    }
}
```

## Requirements

- Rust 1.70+ (MSRV)
- Tokio runtime

## Documentation

- [API Documentation](https://docs.rs/toggly)
- [Toggly Documentation](https://docs.toggly.io/sdks/rust)
- [Examples](https://github.com/ops-ai/toggly-feature-flags/tree/main/toggly-rust/examples)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- [GitHub Issues](https://github.com/ops-ai/toggly-feature-flags/issues)
- [Discord Community](https://discord.gg/toggly)
- [Email Support](mailto:support@toggly.io)
