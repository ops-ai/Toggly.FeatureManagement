# Toggly Axum 0.8 integration

`toggly-axum08` integrates Toggly feature evaluation with Axum 0.8.

```toml
[dependencies]
axum = "0.8"
toggly-axum08 = "0.1"
```

`toggly-axum` remains the adapter for Axum 0.7. The packages have distinct
crate names because Axum 0.7 and 0.8 expose incompatible dependency types.
The public Toggly layer, extractors, and state APIs have the same behavior in
both adapters.
