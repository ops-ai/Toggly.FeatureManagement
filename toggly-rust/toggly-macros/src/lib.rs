//! # Toggly Macros
//!
//! Procedural macros for Toggly feature flags.
//!
//! ## Feature Guard Macro
//!
//! The `#[feature_flag]` attribute macro guards a function with a feature flag check.
//!
//! ```rust,ignore
//! use toggly_macros::feature_flag;
//!
//! #[feature_flag("my-feature")]
//! async fn my_feature_function() -> String {
//!     "Feature is enabled!".to_string()
//! }
//! ```
//!
//! ## Options
//!
//! - `feature` - The feature key (required)
//! - `client` - Expression to get the client (default: from context)
//! - `context` - Expression to get the evaluation context (default: `Default::default()`)
//! - `fallback` - Return value when feature is disabled
//! - `negate` - Invert the feature check

use darling::FromMeta;
use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{parse_macro_input, ItemFn, ReturnType};

/// Arguments for the feature_flag macro.
#[derive(Debug, FromMeta)]
struct FeatureFlagArgs {
    /// Feature key to check.
    feature: String,

    /// Expression to get the Toggly client.
    #[darling(default)]
    client: Option<String>,

    /// Expression to get the evaluation context.
    #[darling(default)]
    context: Option<String>,

    /// Fallback value when feature is disabled.
    #[darling(default)]
    fallback: Option<String>,

    /// Whether to negate the feature check.
    #[darling(default)]
    negate: bool,
}

/// Guard a function with a feature flag check.
///
/// # Example
///
/// ```rust,ignore
/// use toggly_macros::feature_flag;
///
/// #[feature_flag(feature = "my-feature")]
/// async fn my_function() -> Result<String, Error> {
///     Ok("Feature enabled!".to_string())
/// }
///
/// // With custom client and context
/// #[feature_flag(
///     feature = "premium-feature",
///     client = "get_toggly_client()",
///     context = "EvalContext::with_identity(user_id)"
/// )]
/// async fn premium_function(user_id: &str) -> String {
///     "Premium content".to_string()
/// }
///
/// // With fallback value
/// #[feature_flag(feature = "new-ui", fallback = "legacy_ui()")]
/// async fn render_ui() -> Html {
///     render_new_ui()
/// }
/// ```
#[proc_macro_attribute]
pub fn feature_flag(args: TokenStream, input: TokenStream) -> TokenStream {
    let attr_args = match darling::ast::NestedMeta::parse_meta_list(args.into()) {
        Ok(v) => v,
        Err(e) => return TokenStream::from(darling::Error::from(e).write_errors()),
    };
    let input_fn = parse_macro_input!(input as ItemFn);

    let args = match FeatureFlagArgs::from_list(&attr_args) {
        Ok(args) => args,
        Err(e) => return TokenStream::from(e.write_errors()),
    };

    expand_feature_flag(args, input_fn)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand_feature_flag(args: FeatureFlagArgs, input_fn: ItemFn) -> syn::Result<TokenStream2> {
    let feature_key = &args.feature;
    let negate = args.negate;

    let fn_vis = &input_fn.vis;
    let fn_sig = &input_fn.sig;
    let fn_block = &input_fn.block;
    let fn_attrs = &input_fn.attrs;

    // Parse client expression or use default
    let client_expr: TokenStream2 = args
        .client
        .as_deref()
        .unwrap_or("toggly_client")
        .parse()
        .unwrap_or_else(|_| quote!(toggly_client));

    // Parse context expression or use default
    let context_expr: TokenStream2 = args
        .context
        .as_deref()
        .unwrap_or("toggly::EvalContext::default()")
        .parse()
        .unwrap_or_else(|_| quote!(toggly::EvalContext::default()));

    // Generate fallback handling
    let fallback_expr = if let Some(fallback) = &args.fallback {
        let fallback_tokens: TokenStream2 = fallback
            .parse()
            .unwrap_or_else(|_| quote!(Default::default()));
        quote!(return #fallback_tokens;)
    } else {
        // If no fallback, return default for the return type
        match &fn_sig.output {
            ReturnType::Default => quote!(return;),
            ReturnType::Type(_, _) => quote!(return Default::default();),
        }
    };

    // Generate the check condition
    let check_condition = if negate {
        quote!(!enabled)
    } else {
        quote!(enabled)
    };

    let expanded = quote! {
        #(#fn_attrs)*
        #fn_vis #fn_sig {
            let __toggly_client = &#client_expr;
            let __toggly_context = #context_expr;

            let enabled = __toggly_client
                .is_enabled(#feature_key, __toggly_context)
                .await
                .unwrap_or(false);

            if !#check_condition {
                #fallback_expr
            }

            #fn_block
        }
    };

    Ok(expanded)
}

/// Derive macro for creating feature flag enums.
///
/// # Example
///
/// ```rust,ignore
/// use toggly_macros::FeatureFlags;
///
/// #[derive(FeatureFlags)]
/// pub enum Features {
///     #[feature(key = "dark-mode")]
///     DarkMode,
///
///     #[feature(key = "new-dashboard", default = true)]
///     NewDashboard,
///
///     #[feature(key = "beta-features")]
///     BetaFeatures,
/// }
///
/// // Usage:
/// let enabled = Features::DarkMode.is_enabled(&client, context).await?;
/// ```
#[proc_macro_derive(FeatureFlags, attributes(feature))]
pub fn derive_feature_flags(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as syn::DeriveInput);

    expand_feature_flags(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand_feature_flags(input: syn::DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;

    let variants = match &input.data {
        syn::Data::Enum(data) => &data.variants,
        _ => {
            return Err(syn::Error::new_spanned(
                input,
                "FeatureFlags can only be derived for enums",
            ))
        }
    };

    let mut key_arms = Vec::new();
    let mut default_arms = Vec::new();

    for variant in variants {
        let variant_name = &variant.ident;
        let mut feature_key = variant_name.to_string();
        let mut default_value = false;

        // Parse #[feature(...)] attributes
        for attr in &variant.attrs {
            if attr.path().is_ident("feature") {
                attr.parse_nested_meta(|meta| {
                    if meta.path.is_ident("key") {
                        let value: syn::LitStr = meta.value()?.parse()?;
                        feature_key = value.value();
                    } else if meta.path.is_ident("default") {
                        let value: syn::LitBool = meta.value()?.parse()?;
                        default_value = value.value();
                    }
                    Ok(())
                })?;
            }
        }

        key_arms.push(quote! {
            #name::#variant_name => #feature_key,
        });

        default_arms.push(quote! {
            #name::#variant_name => #default_value,
        });
    }

    let expanded = quote! {
        impl #name {
            /// Get the feature key for this variant.
            pub fn key(&self) -> &'static str {
                match self {
                    #(#key_arms)*
                }
            }

            /// Get the default value for this feature.
            pub fn default_value(&self) -> bool {
                match self {
                    #(#default_arms)*
                }
            }

            /// Check if this feature is enabled.
            pub async fn is_enabled(
                &self,
                client: &toggly::TogglyClient,
                context: toggly::EvalContext,
            ) -> toggly::Result<bool> {
                client.is_enabled(self.key(), context).await
            }

            /// Check if this feature is disabled.
            pub async fn is_disabled(
                &self,
                client: &toggly::TogglyClient,
                context: toggly::EvalContext,
            ) -> toggly::Result<bool> {
                client.is_disabled(self.key(), context).await
            }
        }
    };

    Ok(expanded)
}

/// Macro for conditional compilation based on feature flags at runtime.
///
/// This macro provides a more ergonomic way to conditionally execute code.
///
/// # Example
///
/// ```rust,ignore
/// use toggly_macros::feature_gate;
///
/// feature_gate!(client, "my-feature", context, {
///     // Code to run when feature is enabled
///     do_something();
/// }, {
///     // Code to run when feature is disabled (optional)
///     do_fallback();
/// });
/// ```
#[proc_macro]
pub fn feature_gate(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as FeatureGateInput);

    let client = &input.client;
    let feature = &input.feature;
    let context = &input.context;
    let enabled_block = &input.enabled_block;

    let disabled_block = input
        .disabled_block
        .as_ref()
        .map(|b| {
            quote! { else #b }
        })
        .unwrap_or_default();

    let expanded = quote! {
        {
            let __enabled = #client.is_enabled(#feature, #context).await.unwrap_or(false);
            if __enabled #enabled_block #disabled_block
        }
    };

    expanded.into()
}

struct FeatureGateInput {
    client: syn::Expr,
    feature: syn::LitStr,
    context: syn::Expr,
    enabled_block: syn::Block,
    disabled_block: Option<syn::Block>,
}

impl syn::parse::Parse for FeatureGateInput {
    fn parse(input: syn::parse::ParseStream) -> syn::Result<Self> {
        let client: syn::Expr = input.parse()?;
        input.parse::<syn::Token![,]>()?;
        let feature: syn::LitStr = input.parse()?;
        input.parse::<syn::Token![,]>()?;
        let context: syn::Expr = input.parse()?;
        input.parse::<syn::Token![,]>()?;
        let enabled_block: syn::Block = input.parse()?;

        let disabled_block = if input.peek(syn::Token![,]) {
            input.parse::<syn::Token![,]>()?;
            Some(input.parse()?)
        } else {
            None
        };

        Ok(FeatureGateInput {
            client,
            feature,
            context,
            enabled_block,
            disabled_block,
        })
    }
}
