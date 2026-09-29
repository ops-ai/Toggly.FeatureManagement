use super::*;
use darling::ast::NestedMeta;
use quote::quote;
use syn::parse_quote;

fn attribute_args(tokens: TokenStream2) -> FeatureFlagArgs {
    FeatureFlagArgs::from_list(&NestedMeta::parse_meta_list(tokens).unwrap()).unwrap()
}

#[test]
fn default_guard_preserves_function_and_uses_default_fallback() {
    let args = attribute_args(quote!(feature = "checkout"));
    let input: ItemFn = parse_quote! {
        #[inline]
        pub async fn checkout(toggly_client: &Client) -> bool { true }
    };

    let expanded: ItemFn = syn::parse2(expand_feature_flag(args, input).unwrap()).unwrap();
    let text = quote!(#expanded).to_string();
    assert!(text.contains("# [inline] pub async fn checkout"));
    assert!(text.contains("is_enabled (\"checkout\" , __toggly_context)"));
    assert!(text.contains("toggly :: EvalContext :: default ()"));
    assert!(text.contains("return Default :: default ()"));
    assert!(text.contains("{ true }"));
}

#[test]
fn custom_guard_uses_client_context_fallback_and_negation() {
    let args = attribute_args(quote!(
        feature = "legacy",
        client = "get_client()",
        context = "make_context()",
        fallback = "legacy_value()",
        negate = true
    ));
    let input: ItemFn = parse_quote!(
        async fn legacy() -> i32 {
            7
        }
    );

    let text = expand_feature_flag(args, input).unwrap().to_string();
    assert!(text.contains("& get_client ()"));
    assert!(text.contains("= make_context ()"));
    assert!(text.contains("if ! ! enabled"));
    assert!(text.contains("return legacy_value ()"));
}

#[test]
fn guard_for_unit_return_uses_bare_return() {
    let args = attribute_args(quote!(feature = "audit"));
    let input: ItemFn = parse_quote!(
        async fn audit() {}
    );

    let text = expand_feature_flag(args, input).unwrap().to_string();
    assert!(text.contains("if ! enabled { return ; }"));
}

#[test]
fn attribute_rejects_missing_feature_and_bad_argument_syntax() {
    assert!(
        FeatureFlagArgs::from_list(&NestedMeta::parse_meta_list(quote!(negate)).unwrap()).is_err()
    );
    assert!(
        FeatureFlagArgs::from_list(&NestedMeta::parse_meta_list(quote!(feature = )).unwrap())
            .is_err()
    );
}

#[test]
fn derive_uses_custom_keys_and_defaults() {
    let input = parse_quote! {
        pub enum Features {
            #[toggly(key = "new-checkout", default = true)]
            NewCheckout,
            Existing,
        }
    };

    let text = expand_feature_flags(input).unwrap().to_string();
    assert!(text.contains("Features :: NewCheckout => \"new-checkout\""));
    assert!(text.contains("Features :: Existing => \"Existing\""));
    assert!(text.contains("Features :: NewCheckout => true"));
    assert!(text.contains("Features :: Existing => false"));
    assert!(text.contains("client . is_enabled (self . key () , context)"));
    assert!(text.contains("client . is_disabled (self . key () , context)"));
}

#[test]
fn derive_rejects_non_enum_and_malformed_attribute_values() {
    let non_enum = parse_quote!(
        struct Features;
    );
    assert!(expand_feature_flags(non_enum)
        .unwrap_err()
        .to_string()
        .contains("only be derived for enums"));

    let bad_key = parse_quote!(
        enum Features {
            #[toggly(key = 5)]
            Bad,
        }
    );
    assert!(expand_feature_flags(bad_key).is_err());

    let bad_default = parse_quote!(
        enum Features {
            #[toggly(default = "yes")]
            Bad,
        }
    );
    assert!(expand_feature_flags(bad_default).is_err());
}

#[test]
fn feature_gate_parses_optional_disabled_block() {
    let with_disabled: FeatureGateInput =
        syn::parse2(quote!(client, "checkout", context, { enabled() }, {
            disabled()
        }))
        .unwrap();
    assert!(with_disabled.disabled_block.is_some());
    assert_eq!(with_disabled.feature.value(), "checkout");
    let client = &with_disabled.client;
    assert_eq!(quote!(#client).to_string(), "client");

    let without_disabled: FeatureGateInput =
        syn::parse2(quote!(client, "checkout", context, { enabled() })).unwrap();
    assert!(without_disabled.disabled_block.is_none());
    assert!(syn::parse2::<FeatureGateInput>(quote!(client "checkout", context, {})).is_err());
}
