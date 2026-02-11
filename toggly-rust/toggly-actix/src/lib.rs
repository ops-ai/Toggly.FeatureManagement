//! # Toggly Actix Integration
//!
//! Actix-web integration for Toggly feature flags.
//!
//! ## Features
//!
//! - Middleware for feature flag checks
//! - Request extension for accessing the client
//! - Feature guard for routes
//! - Helper extractors
//!
//! ## Quick Start
//!
//! ```rust,ignore
//! use actix_web::{web, App, HttpServer};
//! use toggly::TogglyClient;
//! use toggly_actix::{TogglyMiddleware, TogglyData, FeatureGuard};
//!
//! #[actix_web::main]
//! async fn main() -> std::io::Result<()> {
//!     let client = TogglyClient::builder()
//!         .app_key("your-app-key")
//!         .environment("production")
//!         .build()
//!         .await
//!         .expect("Failed to create Toggly client");
//!
//!     HttpServer::new(move || {
//!         App::new()
//!             .app_data(web::Data::new(client.clone()))
//!             .wrap(TogglyMiddleware::new())
//!             .route("/", web::get().to(index))
//!             .route("/beta", web::get()
//!                 .guard(FeatureGuard::new("beta-features"))
//!                 .to(beta_handler))
//!     })
//!     .bind("127.0.0.1:8080")?
//!     .run()
//!     .await
//! }
//! ```

mod extractor;
mod guard;
mod middleware;

pub use extractor::{Feature, FeatureEnabled, TogglyData};
pub use guard::FeatureGuard;
pub use middleware::TogglyMiddleware;

// Re-export core types for convenience
pub use toggly::{EvalContext, Requirement, TogglyClient, TogglyConfig};
