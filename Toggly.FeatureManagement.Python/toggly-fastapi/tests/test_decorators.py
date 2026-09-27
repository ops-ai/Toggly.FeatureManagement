"""Exercise route decorators with real handler calls and request lookup."""

from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException, Request
from toggly import FeatureRequirement

from toggly_fastapi.decorators import (
    FeatureFlagRouter,
    feature_flag_required,
    feature_gate_required,
    feature_switch,
)


def _request():
    return Request({"type": "http", "method": "GET", "path": "/"})


@pytest.mark.asyncio
async def test_async_feature_flag_accepts_enabled_helper_and_sync_or_async_fallback():
    helper = Mock()
    helper.is_enabled.return_value = True

    @feature_flag_required("new")
    async def handler(*, toggly):
        return "new"

    assert await handler(toggly=helper) == "new"
    helper.is_enabled.assert_called_with("new")

    helper.is_enabled.return_value = False

    @feature_flag_required("new", fallback=lambda **kwargs: "old")
    async def with_sync_fallback(**kwargs):
        return "new"

    async def old(**kwargs):
        return "old-async"

    @feature_flag_required("new", fallback=old)
    async def with_async_fallback(**kwargs):
        return "new"

    assert await with_sync_fallback(toggly=helper) == "old"
    assert await with_async_fallback(toggly=helper) == "old-async"
    with pytest.raises(HTTPException) as error:
        await handler(toggly=helper)
    assert error.value.status_code == 403
    assert error.value.detail == "Feature 'new' is not available"


@pytest.mark.asyncio
async def test_async_flag_finds_request_in_args_and_supports_custom_error():
    helper = Mock()
    helper.is_enabled.return_value = False
    request = _request()

    @feature_flag_required("new", status_code=404, detail="Not launched")
    async def handler(req):
        return "new"

    with patch("toggly_fastapi.decorators.TogglyRequestHelper", return_value=helper), pytest.raises(
        HTTPException
    ) as error:
        await handler(request)
    assert error.value.status_code == 404
    assert error.value.detail == "Not launched"


def test_sync_feature_flag_uses_request_keyword_and_fallback():
    helper = Mock()
    helper.is_enabled.side_effect = [True, False, False]
    request = _request()

    @feature_flag_required("new", fallback=lambda **kwargs: "old")
    def handler(**kwargs):
        return "new"

    @feature_flag_required("new", status_code=404, detail="Missing")
    def denied(**kwargs):
        return "new"

    with patch("toggly_fastapi.decorators.TogglyRequestHelper", return_value=helper):
        assert handler(request=request) == "new"
        assert handler(request=request) == "old"
        with pytest.raises(HTTPException) as error:
            denied(request=request)
    assert error.value.status_code == 404
    assert error.value.detail == "Missing"


def test_sync_flag_without_helper_denies_by_default():
    @feature_flag_required("new")
    def handler():
        return "new"

    with pytest.raises(HTTPException) as error:
        handler()
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_async_gate_checks_any_negation_and_fallbacks():
    helper = Mock()
    helper.evaluate_gate.side_effect = [True, False, False, False]

    @feature_gate_required(["a", "b"], requirement=FeatureRequirement.ANY, negate=True)
    async def handler(*, toggly):
        return "enabled"

    @feature_gate_required(["a"], fallback=lambda **kwargs: "sync-fallback")
    async def sync_fallback(**kwargs):
        return "enabled"

    async def fallback(**kwargs):
        return "async-fallback"

    @feature_gate_required(["a"], fallback=fallback)
    async def async_fallback(**kwargs):
        return "enabled"

    assert await handler(toggly=helper) == "enabled"
    helper.evaluate_gate.assert_any_call(["a", "b"], "any", True)
    assert await sync_fallback(toggly=helper) == "sync-fallback"
    assert await async_fallback(toggly=helper) == "async-fallback"
    with pytest.raises(HTTPException) as error:
        await handler(toggly=helper)
    assert error.value.detail == "Required features are not available"


@pytest.mark.asyncio
async def test_async_gate_finds_request_keyword_and_custom_error():
    helper = Mock()
    helper.evaluate_gate.return_value = False
    request = _request()

    @feature_gate_required(["a"], status_code=404, detail="Gone")
    async def handler(**kwargs):
        return "enabled"

    with patch("toggly_fastapi.decorators.TogglyRequestHelper", return_value=helper), pytest.raises(
        HTTPException
    ) as error:
        await handler(request=request)
    assert error.value.status_code == 404
    assert error.value.detail == "Gone"


def test_sync_gate_finds_positional_request_and_handles_all_outcomes():
    helper = Mock()
    helper.evaluate_gate.side_effect = [True, False, False]
    request = _request()

    @feature_gate_required(["a", "b"], fallback=lambda req: "fallback")
    def handler(req):
        return "enabled"

    @feature_gate_required(["a"], detail="Denied")
    def denied(req):
        return "enabled"

    with patch("toggly_fastapi.decorators.TogglyRequestHelper", return_value=helper):
        assert handler(request) == "enabled"
        assert handler(request) == "fallback"
        with pytest.raises(HTTPException) as error:
            denied(request)
    helper.evaluate_gate.assert_any_call(["a", "b"], "all", False)
    assert error.value.detail == "Denied"


def test_sync_gate_without_helper_denies_by_default():
    @feature_gate_required(["a"])
    def handler():
        return "enabled"

    with pytest.raises(HTTPException) as error:
        handler()
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_async_switch_selects_sync_and_async_handlers():
    helper = Mock()
    helper.is_enabled.side_effect = [True, False, True]
    request = _request()

    async def enabled(*args, **kwargs):
        return "enabled"

    async def disabled(*args, **kwargs):
        return "disabled"

    with patch("toggly_fastapi.decorators.TogglyRequestHelper", return_value=helper):
        assert await feature_switch("a", enabled, lambda *a, **k: "fallback")(request) == "enabled"
        assert await feature_switch("a", lambda *a, **k: "enabled", disabled)(request) == "disabled"
        assert await feature_switch("a", lambda *a, **k: "enabled", disabled)(request) == "enabled"
    assert await feature_switch("a", enabled, disabled)() == "disabled"


def test_sync_switch_uses_request_keyword_and_defaults_to_disabled():
    helper = Mock()
    helper.is_enabled.side_effect = [True, False]
    handler = feature_switch("a", lambda **k: "enabled", lambda **k: "disabled")
    request = _request()
    with patch("toggly_fastapi.decorators.TogglyRequestHelper", return_value=helper):
        assert handler(request=request) == "enabled"
        assert handler(request=request) == "disabled"
    assert handler() == "disabled"


@pytest.mark.parametrize("method", ["get", "post", "put", "patch", "delete", "api_route"])
def test_feature_router_registers_wrapped_handlers(method):
    router = Mock()
    getattr(router, method).return_value.side_effect = lambda endpoint: endpoint
    gate = FeatureFlagRouter(router, "beta", status_code=404, detail="Coming soon")

    @getattr(gate, method)("/resource", name="resource")
    def handler(*, toggly):
        return "enabled"

    getattr(router, method).assert_called_once_with("/resource", name="resource")
    helper = Mock()
    helper.is_enabled.return_value = True
    assert handler(toggly=helper) == "enabled"
    helper.is_enabled.return_value = False
    with pytest.raises(HTTPException) as error:
        handler(toggly=helper)
    assert error.value.status_code == 404
    assert error.value.detail == "Coming soon"
