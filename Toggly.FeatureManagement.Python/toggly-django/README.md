# toggly-django

## Feature blocks

With `toggly-django` 0.4.0+, render enabled and disabled content using matching
`iffeature` blocks. Set `negate=True` on the disabled block:

```html
{% load toggly_tags %}
{% iffeature "new-navigation" %}
  <nav>New navigation</nav>
{% endiffeature %}
{% iffeature "new-navigation" negate=True %}
  <nav>Classic navigation</nav>
{% endiffeature %}
```

`negate` accepts Django template expressions such as `negate=show_disabled` or
`negate=options.reverse|default:False`, resolved on each render. Use the boolean
`True` rather than the nonempty string `"False"`, which is truthy. The feature key
keeps its existing literal interpretation, whether quoted or unquoted. Both
blocks evaluate the same current request context; negation applies to the result.
If no client is configured, the positive block is hidden and the negated block
renders. Only the selected block renders its children; Django autoescaping is
preserved. These presentation gates do not replace authorization.

The legacy `{% else %}` branch remains supported for compatibility. It renders
when the final result, including any negation, is false. Prefer paired blocks in
new templates. Programmatic boolean helpers and view decorators are unchanged.

## Initial context for remote variants

Requires **toggly 0.7.0 and toggly-django 0.3.0**.

```python
# settings.py: application-wide startup defaults, not incoming request values.
TOGGLY = {
    "APP_KEY": "your-app-key",
    "ENABLE_VARIANTS": True,
    "IDENTITY": "user-123",           # Stable variants identity.
    "VARIANT_GROUPS": ["beta"],        # Targeting membership.
    "VARIANT_CLAIMS": {"plan": "pro"}, # String rule attributes.
}
# Programmatic configure_toggly also accepts identity, variant_groups, variant_claims.
```

Startup context avoids an initial variants fetch with incomplete targeting followed by a second fetch. Use one variants client per fixed application-wide context; never change a shared server client's identity for each incoming request. These defaults do not replace request-local `EvaluationContext` for ordinary local boolean evaluation. Enabling remote variants retains the SDK's existing client-wide evaluated-flag behavior.

Groups are trimmed and sent as repeated parameters. Claims must be string-to-string mappings: empty names/values are omitted, whitespace is preserved, and the first 20 claim names in sorted order are sent. Omitted or empty collections send no targeting parameters. Caller collections are copied. Variants caches and conditional validators match the complete context; legacy unscoped variants caches require a fresh fetch. Global definition caches retain their existing behavior.
