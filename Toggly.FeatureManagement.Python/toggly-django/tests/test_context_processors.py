"""Template context access uses the same client and request context as views."""

from unittest.mock import Mock, patch

from django.http import HttpRequest
from django.template import Context, Template

from toggly_django.context_processors import TemplateToggly, toggly_context


def test_template_context_checks_flags_with_lazy_request_context():
    request = HttpRequest()
    client = Mock()
    client.feature_flags = {"new-feature": True}
    client.is_enabled.side_effect = lambda key, context, default=False: key == "new-feature"
    evaluation_context = object()

    with patch("toggly_django.context_processors.get_client", return_value=client), patch(
        "toggly_django.context_processors.get_context_from_request",
        return_value=evaluation_context,
    ) as context_factory:
        toggly = toggly_context(request)["toggly"]
        assert toggly.flags == {"new-feature": True}
        assert toggly.flags is toggly.flags
        assert toggly.is_enabled.new_feature is True
        assert toggly.is_disabled.new_feature is False
        assert toggly.is_enabled["new-feature"] is True
        assert toggly.is_disabled["missing"] is True
        assert toggly.check("missing", default=True) is False
        assert toggly.context is evaluation_context
        context_factory.assert_called_once_with(request)
    client.is_enabled.assert_any_call("new-feature", evaluation_context, default=False)


def test_template_context_without_client_uses_defaults_and_empty_flags():
    with patch("toggly_django.context_processors.get_client", return_value=None):
        toggly = TemplateToggly(HttpRequest())
        assert toggly.flags == {}
        assert toggly.check("missing") is False
        assert toggly.check("missing", default=True) is True
        assert toggly.is_enabled["missing"] is False
        assert toggly.is_disabled.missing is True


def test_template_renders_attribute_and_item_flag_access():
    client = Mock()
    client.feature_flags = {"new": True}
    client.is_enabled.side_effect = lambda key, context, default=False: key == "new"
    with patch("toggly_django.context_processors.get_client", return_value=client), patch(
        "toggly_django.context_processors.get_context_from_request", return_value=object()
    ):
        result = Template(
            "{% if toggly.is_enabled.new %}on{% endif %}"
            "{% if toggly.is_disabled.missing %}-off{% endif %}"
            "{% if toggly.flags.new %}-listed{% endif %}"
        ).render(Context(toggly_context(HttpRequest())))
    assert result == "on-off-listed"
