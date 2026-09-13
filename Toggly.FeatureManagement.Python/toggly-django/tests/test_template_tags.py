"""Real Django templates exercise complementary feature blocks and legacy syntax."""

from unittest.mock import Mock

import pytest
from django.template import Context, Engine, TemplateSyntaxError
from toggly import TogglyClient, TogglyConfig

from toggly_django.templatetags import toggly_tags


@pytest.fixture
def engine():
    return Engine(libraries={"toggly_tags": "toggly_django.templatetags.toggly_tags"})


@pytest.fixture
def client(monkeypatch):
    client = TogglyClient(
        TogglyConfig(
            feature_defaults={"on": True, "off": False, "literal.key": True},
            disable_background_refresh=True,
            enable_live_updates=False,
            enable_usage_tracking=False,
        )
    )
    monkeypatch.setattr(toggly_tags, "get_client", lambda: client)
    yield client
    client.close()


def render(engine, body, values=None):
    return engine.from_string("{% load toggly_tags %}" + body).render(Context(values or {}))


@pytest.mark.parametrize(
    "key,expected", [("on", "enabled"), ("off", "disabled"), ("missing", "disabled")]
)
def test_positive_and_negated_blocks_are_exclusive(engine, client, key, expected):
    body = (
        "{% iffeature '" + key + "' %}<p>enabled</p>{% endiffeature %}"
        "{% iffeature '" + key + "' negate=True %}<p>disabled</p>{% endiffeature %}"
    )
    assert render(engine, body) == f"<p>{expected}</p>"


def test_missing_client_selects_only_negated_content(engine, monkeypatch):
    monkeypatch.setattr(toggly_tags, "get_client", lambda: None)
    assert (
        render(
            engine,
            "{% iffeature 'on' %}enabled{% endiffeature %}"
            "{% iffeature 'on' negate=True %}disabled{% endiffeature %}",
        )
        == "disabled"
    )


@pytest.mark.parametrize(
    "expression,values,expected",
    [
        ("True", {}, "disabled"),
        ("False", {}, "enabled"),
        ("choice", {"choice": True}, "disabled"),
        ("choice", {"choice": False}, "enabled"),
        ("options.reverse", {"options": {"reverse": True}}, "disabled"),
        ("missing", {}, "enabled"),
        ("choice|default:False", {}, "enabled"),
        ('choice|default:"reverse the gate"', {}, "disabled"),
    ],
)
def test_negation_uses_django_filter_expressions(engine, client, expression, values, expected):
    assert (
        render(
            engine,
            "{% iffeature 'on' negate="
            + expression
            + " %}enabled{% else %}disabled{% endiffeature %}",
            values,
        )
        == expected
    )


def test_negation_resolves_again_for_each_render(engine, client):
    compiled = engine.from_string(
        "{% load toggly_tags %}{% iffeature 'on' negate=reverse %}visible{% endiffeature %}"
    )
    assert compiled.render(Context({"reverse": False})) == "visible"
    assert compiled.render(Context({"reverse": True})) == ""


@pytest.mark.parametrize("key", ["on", "'on'", '"on"', "literal.key"])
def test_original_literal_feature_key_interpretation_is_preserved(engine, client, key):
    # Bare keys stay literal, even when a same-named template variable exists.
    assert (
        render(engine, "{% iffeature " + key + " %}yes{% endiffeature %}", {"on": "off"}) == "yes"
    )


@pytest.mark.parametrize("key,expected", [("on", "enabled"), ("off", "disabled")])
def test_legacy_else_keeps_its_behavior(engine, client, key, expected):
    assert (
        render(
            engine,
            "{% iffeature '" + key + "' %}enabled{% else %}disabled{% endiffeature %}",
        )
        == expected
    )


def test_nested_blocks_preserve_parser_boundaries(engine, client):
    assert (
        render(
            engine,
            "{% iffeature 'on' %}outer:"
            "{% iffeature 'off' negate=True %}inner{% else %}wrong-inner{% endiffeature %}"
            "{% else %}wrong-outer{% endiffeature %}",
        )
        == "outer:inner"
    )


@pytest.mark.parametrize(
    "arguments",
    [
        "",
        "'on' True",
        "'on' unknown=True",
        "'on' negate",
        "'on' negate=",
        "'on' negate = True",
        "'on' negate=True negate=False",
        "'on' negate=True unknown=False",
        "'on' negate=True|",
        "'on' negate=value|not_a_filter",
    ],
)
def test_invalid_options_fail_at_template_compilation(engine, arguments):
    with pytest.raises(TemplateSyntaxError):
        engine.from_string(
            "{% load toggly_tags %}{% iffeature " + arguments + " %}x{% endiffeature %}"
        )


@pytest.mark.parametrize("ending", ["", "{% else %}"])
def test_unclosed_blocks_are_rejected(engine, ending):
    with pytest.raises(TemplateSyntaxError):
        engine.from_string("{% load toggly_tags %}{% iffeature 'on' negate=True %}x" + ending)


@pytest.mark.parametrize("key,selected", [("on", "enabled"), ("off", "disabled")])
def test_only_selected_children_run_and_html_is_escaped(engine, client, key, selected):
    calls = []

    def content(name):
        def value():
            calls.append(name)
            return '<script>"unsafe" & value</script>'

        return value

    body = (
        "{% iffeature '" + key + "' %}{{ enabled }}{% endiffeature %}"
        "{% iffeature '" + key + "' negate=True %}{{ disabled }}{% endiffeature %}"
    )
    assert render(engine, body, {name: content(name) for name in ["enabled", "disabled"]}) == (
        "&lt;script&gt;&quot;unsafe&quot; &amp; value&lt;/script&gt;"
    )
    assert calls == [selected]


def test_negation_preserves_request_evaluation_context(engine, client, rf, monkeypatch):
    request = rf.get("/feature-test/")
    request.toggly_entity = {"kind": "Order", "key": "ord-vip", "attributes": {"Vip": True}}
    evaluate = Mock(wraps=client.is_enabled)
    monkeypatch.setattr(client, "is_enabled", evaluate)
    assert (
        render(
            engine, "{% iffeature 'off' negate=True %}yes{% endiffeature %}", {"request": request}
        )
        == "yes"
    )
    feature, context = evaluate.call_args.args
    assert feature == "off"
    assert context.traits["path"] == "/feature-test/"
    assert context.entity == request.toggly_entity
