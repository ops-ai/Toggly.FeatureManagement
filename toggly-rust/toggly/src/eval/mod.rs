//! Feature evaluation engine.

mod engine;
mod filters;
mod registry;
mod sticky_hash;
mod user_agent;

pub use engine::Engine;
pub use filters::*;
pub use registry::Registry;
pub use sticky_hash::{compute_percentile, segment_percentage_passes};
pub use user_agent::{parse_user_agent, ParsedUserAgent};
