//! # Toggly Rocket Integration
//!
//! Rocket framework integration for Toggly feature flags.
//!
//! ## Features
//!
//! - Request guards for feature checks
//! - Managed state for the client
//! - Fairings for setup
//! - Request-scoped `Feature::get_variant` (identity from headers or client config)
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
//! #[get("/checkout")]
//! async fn checkout(feature: Feature) -> String {
//!     // Uses X-User-Id / X-Identity when present; otherwise config / set_identity.
//!     match feature.get_variant("checkout-flow").await {
//!         Ok(a) => format!("{:?}", a.variant_name),
//!         Err(_) => "error".into(),
//!     }
//! }
//!
//! #[get("/beta")]
//! async fn beta(_guard: FeatureEnabled) -> &'static str {
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
//!         .mount("/", routes![index, checkout, beta])
//! }
//! ```

mod fairing;
mod guard;

pub use fairing::TogglyFairing;
pub use guard::{Feature, FeatureDisabled, FeatureEnabled};

// Re-export core types for convenience
pub use toggly::{EvalContext, Requirement, TogglyClient, TogglyConfig, VariantAssignment};
