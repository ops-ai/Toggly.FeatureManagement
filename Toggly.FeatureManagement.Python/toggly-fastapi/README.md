# toggly-fastapi

## Feature variants

Requires **toggly 1.0.0+**. Feature variants are assigned locally from the
same cached definitions used for `is_enabled` — there is no separate
"variants mode" to enable.

```python
from toggly_fastapi import configure_toggly, get_toggly_client

configure_toggly(
    app_key="your-app-key",
    identity="user-123",  # Default identity used when a request/user_id isn't supplied.
)  # Call during application startup.

client = get_toggly_client()
variant = client.get_variant("checkout-flow", user_id="user-123")
if variant is not None and variant.enabled and variant.name == "B":
    ...
```

See the core `toggly` package README for the full `get_variant` /
`get_variant_value` API and the Microsoft.FeatureManagement-parity assignment
rules.
