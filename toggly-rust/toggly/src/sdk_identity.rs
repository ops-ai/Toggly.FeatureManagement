pub const SDK_ID: &str = "rust";

pub fn sdk_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn sdk_user_agent() -> String {
    format!("toggly-{}/{}", SDK_ID, sdk_version())
}

pub fn append_sdk_query(base_url: &str, cached_revision: Option<&str>) -> String {
    let mut url = url::Url::parse(base_url).expect("valid WebSocket URL");
    {
        let mut query = url.query_pairs_mut();
        if let Some(rev) = cached_revision.filter(|value| !value.is_empty()) {
            query.append_pair("rev", rev);
        }
        query.append_pair("sdk", SDK_ID);
        query.append_pair("sdkVersion", sdk_version());
    }
    url.to_string()
}
