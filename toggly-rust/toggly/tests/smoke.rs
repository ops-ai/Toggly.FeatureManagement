use toggly::{EvalContext, TogglyClient};

const SMOKE_ENVIRONMENT: &str = "Production";
const DEFINITIONS_URL: &str = "https://definitions.toggly.io/";

#[tokio::test]
async fn smoke_unsigned_definitions() -> toggly::Result<()> {
    let app_key = match std::env::var("TOGGLY_SMOKE_APP_KEY_BACKEND") {
        Ok(v) if !v.is_empty() => v,
        _ => return Ok(()),
    };

    let client = TogglyClient::builder()
        .app_key(app_key)
        .environment(SMOKE_ENVIRONMENT)
        .definitions_url(DEFINITIONS_URL)
        .use_signed_definitions(false)
        .disable_background_refresh(true)
        .build()
        .await?;

    let flag_on = client.is_enabled("FlagOn", EvalContext::default()).await?;
    let flag_off = client.is_enabled("FlagOff", EvalContext::default()).await?;

    assert!(flag_on, "Expected FlagOn to be true");
    assert!(!flag_off, "Expected FlagOff to be false");
    client.close().await;

    Ok(())
}

#[tokio::test]
async fn smoke_signed_definitions() -> toggly::Result<()> {
    let app_key = match std::env::var("TOGGLY_SMOKE_APP_KEY_BACKEND") {
        Ok(v) if !v.is_empty() => v,
        _ => return Ok(()),
    };

    let client = TogglyClient::builder()
        .app_key(app_key)
        .environment(SMOKE_ENVIRONMENT)
        .definitions_url(DEFINITIONS_URL)
        .use_signed_definitions(true)
        .disable_background_refresh(true)
        .build()
        .await?;

    let flag_on = client.is_enabled("FlagOn", EvalContext::default()).await?;
    let flag_off = client.is_enabled("FlagOff", EvalContext::default()).await?;

    assert!(flag_on, "Expected FlagOn to be true");
    assert!(!flag_off, "Expected FlagOff to be false");
    client.close().await;

    Ok(())
}
