use axum::{routing::get, Router};
use toggly_axum08::TogglyLayer;

async fn home() -> &'static str {
    "Toggly Axum 0.8 host"
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

    println!("toggly-axum08 packaged host compiled");
}
