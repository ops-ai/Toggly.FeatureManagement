//! # Toggly Axum Integration
//!
//! Axum integration for Toggly feature flags.
//!
//! ## Features
//!
//! - Tower middleware layer for feature flag checks
//! - Axum extractors for handlers
//! - State extension support
//!
//! ## Quick Start
//!
//! ```rust,ignore
//! use axum::{routing::get, Router, Extension};
//! use toggly::TogglyClient;
//! use toggly_axum::{TogglyLayer, Feature};
//! use std::sync::Arc;
//!
//! #[tokio::main]
//! async fn main() {
//!     let client = TogglyClient::builder()
//!         .app_key("your-app-key")
//!         .environment("production")
//!         .build()
//!         .await
//!         .expect("Failed to create Toggly client");
//!
//!     let app = Router::new()
//!         .route("/", get(index))
//!         .route("/beta", get(beta_handler).layer(TogglyLayer::require("beta-features")))
//!         .layer(Extension(Arc::new(client)));
//!
//!     let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
//!     axum::serve(listener, app).await.unwrap();
//! }
//!
//! async fn index() -> &'static str {
//!     "Hello, World!"
//! }
//!
//! async fn beta_handler(feature: Feature) -> &'static str {
//!     "Beta feature!"
//! }
//! ```

mod extractor;
mod layer;
mod state;

pub use extractor::{Feature, FeatureEnabled, TogglyExtractor};
pub use layer::{TogglyLayer, TogglyService};
pub use state::TogglyState;

// Re-export core types for convenience
pub use toggly::{EvalContext, Requirement, TogglyClient, TogglyConfig};
