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

## Feature variants

Requires **toggly 1.0.0+**. Feature variants are assigned locally from the
same cached definitions used for `iffeature`/`is_feature_enabled` — there is
no separate "variants mode" to enable.

```python
# settings.py
TOGGLY = {
    "APP_KEY": "your-app-key",
    "IDENTITY": "user-123",  # Default identity used when a request/user_id isn't supplied.
}
```

```python
from toggly_django.utils import get_client

client = get_client()
variant = client.get_variant("checkout-flow", user_id=str(request.user.pk))
if variant is not None and variant.enabled and variant.name == "B":
    ...
```

See the core `toggly` package README for the full `get_variant` /
`get_variant_value` API and the Microsoft.FeatureManagement-parity assignment
rules.
