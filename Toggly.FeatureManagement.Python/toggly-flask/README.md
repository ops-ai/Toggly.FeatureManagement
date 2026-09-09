# toggly-flask

## Initial context for remote variants

Requires **toggly 0.7.0 and toggly-flask 0.3.0** (release pending; these APIs are not in the currently published packages).

```python
from flask import Flask
from toggly_flask import Toggly

app = Flask(__name__)
app.config.update(
    TOGGLY_APP_KEY="your-app-key",
    TOGGLY_ENABLE_VARIANTS=True,
    TOGGLY_IDENTITY="user-123",           # Stable variants identity.
    TOGGLY_VARIANT_GROUPS=["beta"],        # Targeting membership.
    TOGGLY_VARIANT_CLAIMS={"plan": "pro"}, # String rule attributes.
)
Toggly(app)  # Context is present before the first request.
```

Startup context avoids an initial variants fetch with incomplete targeting followed by a second fetch. Use one variants client per fixed application-wide context; never change a shared server client's identity for each incoming request. These defaults do not replace request-local `EvaluationContext` for ordinary local boolean evaluation. Enabling remote variants retains the SDK's existing client-wide evaluated-flag behavior.

Groups are trimmed and sent as repeated parameters. Claims must be string-to-string mappings: empty names/values are omitted, whitespace is preserved, and the first 20 claim names in sorted order are sent. Omitted or empty collections send no targeting parameters. Caller collections are copied. Variants caches and conditional validators match the complete context; legacy unscoped variants caches require a fresh fetch. Global definition caches retain their existing behavior.
