//! # Toggly Rocket Integration
//!
//! Rocket framework integration for Toggly feature flags.
//!
//! ## Features
//!
//! - Request guards for feature checks
//! - Managed state for the client
//! - Fairings for setup
//!
//! ## Quick Start
//!
//! ```rust,ignore
//! use rocket::{get, launch, routes, State};
//! use toggly::TogglyClient;
//! use toggly_rocket::{Feature, FeatureEnabled};
//!
//! #[get("/")]
//! async fn index(feature: Feature) -> &'static str {
//!     if feature.is_enabled("my-feature").await {
//!         "Feature enabled!"
//!     } else {
//!         "Feature disabled"
//!     }
//! }
//!
//! #[get("/beta")]
//! async fn beta(_guard: FeatureEnabled<"beta-features">) -> &'static str {
//!     "Welcome to the beta!"
//! }
//!
//! #[launch]
//! async fn rocket() -> _ {
//!     let client = TogglyClient::builder()
//!         .app_key("your-app-key")
//!         .environment("production")
//!         .build()
//!         .await
//!         .expect("Failed to create Toggly client");
//!
//!     rocket::build()
//!         .manage(client)
//!         .mount("/", routes![index, beta])
//! }
//! ```

mod guard;
mod fairing;

pub use guard::{Feature, FeatureEnabled, FeatureDisabled};
pub use fairing::TogglyFairing;

// Re-export core types for convenience
pub use toggly::{EvalContext, Requirement, TogglyClient, TogglyConfig};
