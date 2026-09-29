use toggly_macros::{feature_flag, feature_gate, FeatureFlags};

#[derive(Default)]
struct MockClient {
    enabled: bool,
    fails: bool,
}

impl MockClient {
    async fn is_enabled(&self, _key: &str, context: toggly::EvalContext) -> toggly::Result<bool> {
        assert!(context.id == 0 || context.id == 7);
        if self.fails {
            Err(())
        } else {
            Ok(self.enabled)
        }
    }

    async fn is_disabled(&self, key: &str, context: toggly::EvalContext) -> toggly::Result<bool> {
        self.is_enabled(key, context).await.map(|enabled| !enabled)
    }
}

mod toggly {
    #[derive(Default)]
    pub struct EvalContext {
        pub id: u8,
    }

    pub type Result<T> = std::result::Result<T, ()>;
    pub type TogglyClient = super::MockClient;
}

#[feature_flag(feature = "checkout")]
async fn checkout(toggly_client: &MockClient) -> u8 {
    9
}

#[feature_flag(
    feature = "legacy",
    client = "toggly_client",
    context = "toggly::EvalContext { id: 7 }",
    fallback = "42",
    negate = true
)]
async fn legacy(toggly_client: &MockClient) -> u8 {
    7
}

#[derive(FeatureFlags)]
enum Features {
    #[toggly(key = "new-checkout", default = true)]
    NewCheckout,
    Existing,
}

#[tokio::test]
async fn attribute_guards_body_and_applies_custom_fallback() {
    assert_eq!(checkout(&MockClient::default()).await, 0);
    assert_eq!(
        checkout(&MockClient {
            enabled: true,
            fails: false
        })
        .await,
        9
    );
    assert_eq!(
        checkout(&MockClient {
            enabled: true,
            fails: true
        })
        .await,
        0
    );

    assert_eq!(legacy(&MockClient::default()).await, 7);
    assert_eq!(
        legacy(&MockClient {
            enabled: true,
            fails: false
        })
        .await,
        42
    );
}

#[tokio::test]
async fn derive_exposes_keys_defaults_and_client_checks() {
    assert_eq!(Features::NewCheckout.key(), "new-checkout");
    assert!(Features::NewCheckout.default_value());
    assert_eq!(Features::Existing.key(), "Existing");
    assert!(!Features::Existing.default_value());

    let client = MockClient {
        enabled: true,
        fails: false,
    };
    assert!(Features::NewCheckout
        .is_enabled(&client, toggly::EvalContext::default())
        .await
        .unwrap());
    assert!(!Features::Existing
        .is_disabled(&client, toggly::EvalContext::default())
        .await
        .unwrap());
}

#[tokio::test]
async fn gate_runs_only_the_matching_block() {
    let client = MockClient {
        enabled: true,
        fails: false,
    };
    let mut result = 0;
    feature_gate!(
        client,
        "checkout",
        toggly::EvalContext::default(),
        {
            result += 1;
        },
        {
            result += 10;
        }
    );
    assert_eq!(result, 1);

    let client = MockClient::default();
    feature_gate!(
        client,
        "checkout",
        toggly::EvalContext::default(),
        {
            result += 1;
        },
        {
            result += 10;
        }
    );
    assert_eq!(result, 11);

    feature_gate!(client, "checkout", toggly::EvalContext::default(), {
        result += 1;
    });
    assert_eq!(result, 11);
}
