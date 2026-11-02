use axum::{routing::get, Router};
use toggly_axum::TogglyLayer;

async fn home() -> &'static str {
    "Toggly Axum host"
}

async fn gated() -> &'static str {
    "gated"
}

#[tokio::main]
async fn main() {
    let _app = Router::<()>::new().route("/", get(home)).route(
        "/gated",
        get(gated).layer(TogglyLayer::require("example-feature")),
    );

    println!("toggly-axum packaged host compiled");
}
