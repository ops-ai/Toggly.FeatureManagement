# toggly-flask

## Feature variants

Requires **toggly 1.0.0+**. Feature variants are assigned locally from the
same cached definitions used for `is_enabled` — there is no separate
"variants mode" to enable.

```python
from flask import Flask
from toggly_flask import Toggly, get_client

app = Flask(__name__)
app.config.update(
    TOGGLY_APP_KEY="your-app-key",
    TOGGLY_IDENTITY="user-123",  # Default identity used when a request/user_id isn't supplied.
)
Toggly(app)

client = get_client()
variant = client.get_variant("checkout-flow", user_id="user-123")
if variant is not None and variant.enabled and variant.name == "B":
    ...
```

See the core `toggly` package README for the full `get_variant` /
`get_variant_value` API and the Microsoft.FeatureManagement-parity assignment
rules.
