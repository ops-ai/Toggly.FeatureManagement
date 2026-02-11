"""Django template tags for Toggly feature flags."""

from __future__ import annotations

from typing import Any

from django import template
from django.http import HttpRequest

from toggly import FeatureRequirement
from toggly_django.utils import get_client, get_context_from_request

register = template.Library()


@register.simple_tag(takes_context=True)
def feature_enabled(
    context: dict[str, Any],
    feature_key: str,
    default: bool = False,
) -> bool:
    """Check if a feature is enabled.

    Usage:
        {% feature_enabled 'my-feature' as is_enabled %}
        {% if is_enabled %}
            Feature is enabled!
        {% endif %}

    Args:
        context: Template context.
        feature_key: The feature key to check.
        default: Default value if client unavailable.

    Returns:
        True if the feature is enabled.
    """
    request: HttpRequest | None = context.get("request")
    client = get_client()

    if client is None:
        return default

    eval_context = get_context_from_request(request) if request else None
    return client.is_enabled(feature_key, eval_context, default=default)


@register.simple_tag(takes_context=True)
def feature_disabled(
    context: dict[str, Any],
    feature_key: str,
    default: bool = True,
) -> bool:
    """Check if a feature is disabled.

    Usage:
        {% feature_disabled 'my-feature' as is_disabled %}
        {% if is_disabled %}
            Feature is disabled!
        {% endif %}

    Args:
        context: Template context.
        feature_key: The feature key to check.
        default: Default value if client unavailable.

    Returns:
        True if the feature is disabled.
    """
    return not feature_enabled(context, feature_key, default=not default)


@register.simple_tag(takes_context=True)
def feature_gate(
    context: dict[str, Any],
    *feature_keys: str,
    requirement: str = "all",
    negate: bool = False,
) -> bool:
    """Evaluate multiple features as a gate.

    Usage:
        {% feature_gate 'feature1' 'feature2' as gate_passed %}
        {% if gate_passed %}
            All features enabled!
        {% endif %}

        {% feature_gate 'feature1' 'feature2' requirement='any' as any_enabled %}
        {% if any_enabled %}
            At least one feature enabled!
        {% endif %}

    Args:
        context: Template context.
        *feature_keys: Feature keys to check.
        requirement: 'all' or 'any'.
        negate: Whether to negate the result.

    Returns:
        True if the gate passes.
    """
    request: HttpRequest | None = context.get("request")
    client = get_client()

    if client is None:
        return False

    eval_context = get_context_from_request(request) if request else None
    req = (
        FeatureRequirement.ALL
        if requirement.lower() == "all"
        else FeatureRequirement.ANY
    )
    return client.evaluate_gate(list(feature_keys), req, eval_context, negate)


@register.tag(name="iffeature")
def do_iffeature(parser: template.base.Parser, token: template.base.Token):
    """Conditional block based on feature flag.

    Usage:
        {% iffeature 'my-feature' %}
            Feature is enabled!
        {% else %}
            Feature is disabled!
        {% endiffeature %}

    Args:
        parser: Template parser.
        token: Template token.

    Returns:
        IfFeatureNode for rendering.
    """
    bits = token.split_contents()
    if len(bits) != 2:
        raise template.TemplateSyntaxError(
            f"'{bits[0]}' tag takes exactly one argument (feature key)"
        )

    feature_key = bits[1]
    # Remove quotes if present
    if (feature_key.startswith("'") and feature_key.endswith("'")) or (
        feature_key.startswith('"') and feature_key.endswith('"')
    ):
        feature_key = feature_key[1:-1]

    nodelist_true = parser.parse(("else", "endiffeature"))
    token = parser.next_token()

    if token.contents == "else":
        nodelist_false = parser.parse(("endiffeature",))
        parser.delete_first_token()
    else:
        nodelist_false = template.NodeList()

    return IfFeatureNode(feature_key, nodelist_true, nodelist_false)


class IfFeatureNode(template.Node):
    """Template node for iffeature tag."""

    def __init__(
        self,
        feature_key: str,
        nodelist_true: template.NodeList,
        nodelist_false: template.NodeList,
    ) -> None:
        """Initialize the node.

        Args:
            feature_key: The feature key to check.
            nodelist_true: Nodes to render if feature is enabled.
            nodelist_false: Nodes to render if feature is disabled.
        """
        self.feature_key = feature_key
        self.nodelist_true = nodelist_true
        self.nodelist_false = nodelist_false

    def render(self, context: template.Context) -> str:
        """Render the node.

        Args:
            context: Template context.

        Returns:
            Rendered content.
        """
        request: HttpRequest | None = context.get("request")
        client = get_client()

        is_enabled = False
        if client is not None:
            eval_context = get_context_from_request(request) if request else None
            is_enabled = client.is_enabled(self.feature_key, eval_context)

        if is_enabled:
            return self.nodelist_true.render(context)
        return self.nodelist_false.render(context)


@register.filter(name="feature_enabled")
def feature_enabled_filter(request: HttpRequest, feature_key: str) -> bool:
    """Template filter to check if feature is enabled.

    Usage:
        {% if request|feature_enabled:'my-feature' %}
            Feature is enabled!
        {% endif %}

    Args:
        request: The request object.
        feature_key: The feature key to check.

    Returns:
        True if feature is enabled.
    """
    client = get_client()
    if client is None:
        return False

    context = get_context_from_request(request)
    return client.is_enabled(feature_key, context)


@register.filter(name="feature_disabled")
def feature_disabled_filter(request: HttpRequest, feature_key: str) -> bool:
    """Template filter to check if feature is disabled.

    Usage:
        {% if request|feature_disabled:'my-feature' %}
            Feature is disabled!
        {% endif %}

    Args:
        request: The request object.
        feature_key: The feature key to check.

    Returns:
        True if feature is disabled.
    """
    return not feature_enabled_filter(request, feature_key)
