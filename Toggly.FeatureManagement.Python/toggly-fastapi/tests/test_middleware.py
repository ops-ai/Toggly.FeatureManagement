"""Tests for FastAPI middleware."""

import sys
from unittest.mock import MagicMock, patch

import pytest

from tests.test_helpers import create_test_app, set_middleware_client


def _reload_modules():
    """Reload modules to apply patches."""
    modules_to_reload = [
        key
        for key in list(sys.modules.keys())
        if key.startswith("toggly_fastapi") or key.startswith("toggly")
    ]
    for mod in modules_to_reload:
        sys.modules.pop(mod, None)


class TestConfigureToggly:
    """Tests for configure_toggly function."""

    def test_creates_client(self):
        """Test that configure_toggly creates a client."""
        _reload_modules()

        mock_instance = MagicMock()

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock(return_value=mock_instance),
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=None),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from toggly_fastapi.middleware import configure_toggly

            result = configure_toggly(app_key="test-key")

            mock_instance.init.assert_called_once()
            assert result is mock_instance

    def test_uses_provided_client(self):
        """Test that configure_toggly uses provided client."""
        _reload_modules()

        mock_client = MagicMock()

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=None),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from toggly_fastapi.middleware import configure_toggly

            result = configure_toggly(client=mock_client)

            assert result is mock_client


class TestGetTogglyClient:
    """Tests for get_toggly_client function."""

    def test_returns_module_client(self):
        """Test that get_toggly_client returns the module-level client."""
        _reload_modules()

        mock_client = MagicMock()

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=mock_client),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from toggly_fastapi.middleware import get_toggly_client

            result = get_toggly_client()
            assert result is mock_client

    def test_falls_back_to_default_client(self):
        """Test fallback to default client."""
        _reload_modules()

        mock_client = MagicMock()

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=mock_client),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from toggly_fastapi.middleware import get_toggly_client

            result = get_toggly_client()
            # Returns default client
            assert result is mock_client


class TestTogglyMiddleware:
    """Tests for TogglyMiddleware."""

    def test_attaches_helper_to_request_state(self):
        """Test that middleware attaches helper to request.state."""
        _reload_modules()

        mock_client = MagicMock()

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=mock_client),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from fastapi import FastAPI, Request
            from starlette.testclient import TestClient

            from toggly_fastapi.middleware import TogglyMiddleware

            app = create_test_app()
            app.add_middleware(TogglyMiddleware)

            @app.get("/test")
            async def test_endpoint(request: Request):
                return {"has_toggly": hasattr(request.state, "toggly")}

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["has_toggly"] is True

    def test_helper_provides_is_enabled(self):
        """Test that helper provides is_enabled method."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=mock_client),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from fastapi import FastAPI, Request
            from starlette.testclient import TestClient

            from toggly_fastapi.middleware import TogglyMiddleware

            app = create_test_app()
            app.add_middleware(TogglyMiddleware)

            @app.get("/test")
            async def test_endpoint(request: Request):
                return {"enabled": request.state.toggly.is_enabled("my-feature")}

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["enabled"] is True


class TestTogglyRequestHelper:
    """Tests for TogglyRequestHelper."""

    def test_is_enabled_returns_default_without_client(self):
        """Test is_enabled returns default when no client."""
        _reload_modules()

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=None),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from starlette.requests import Request

            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            request = Request(mock_scope)

            helper = TogglyRequestHelper(request)

            assert helper.is_enabled("some-feature") is False
            assert helper.is_enabled("some-feature", default=True) is True

    def test_is_enabled_calls_client(self):
        """Test is_enabled delegates to client."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=mock_client),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from starlette.requests import Request

            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            result = helper.is_enabled("my-feature")

            assert result is True
            mock_client.is_enabled.assert_called()

    def test_is_disabled_negates_is_enabled(self):
        """Test is_disabled returns opposite of is_enabled."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=mock_client),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from starlette.requests import Request

            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            assert helper.is_disabled("my-feature") is False

    def test_evaluate_gate(self):
        """Test evaluate_gate method."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=mock_client),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from starlette.requests import Request

            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            result = helper.evaluate_gate(["feature1", "feature2"])

            assert result is True
            mock_client.evaluate_gate.assert_called()

    def test_flags_property(self):
        """Test flags property."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.feature_flags = {"feature1": True, "feature2": False}

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MagicMock,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=mock_client),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from starlette.requests import Request

            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            assert helper.flags == {"feature1": True, "feature2": False}

    def test_context_is_cached(self):
        """Test that context is cached."""
        _reload_modules()

        # Create a proper mock for EvaluationContext
        class MockEvaluationContext:
            def __init__(self, identity=None, groups=None, traits=None, entity=None, **kwargs):
                self.identity = identity
                self.groups = groups or []
                self.traits = traits or {}
                self.entity = entity

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MockEvaluationContext,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=None),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from starlette.requests import Request

            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            context1 = helper.context
            context2 = helper.context

            assert context1 is context2


class TestGetContextFromRequest:
    """Tests for get_context_from_request function."""

    def test_extracts_request_metadata(self):
        """Test extraction of request metadata."""
        _reload_modules()

        class MockEvaluationContext:
            def __init__(self, identity=None, groups=None, traits=None, entity=None, **kwargs):
                self.identity = identity
                self.groups = groups or []
                self.traits = traits or {}
                self.entity = entity

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MockEvaluationContext,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=None),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from starlette.requests import Request

            from toggly_fastapi.middleware import get_context_from_request

            mock_scope = {
                "type": "http",
                "method": "POST",
                "path": "/api/test",
                "query_string": b"",
                "headers": [],
            }
            request = Request(mock_scope)

            context = get_context_from_request(request)

            assert context.traits["path"] == "/api/test"
            assert context.traits["method"] == "POST"

    def test_extracts_user_from_state(self):
        """Test extraction of user from request.state."""
        _reload_modules()

        class MockEvaluationContext:
            def __init__(self, identity=None, groups=None, traits=None, entity=None, **kwargs):
                self.identity = identity
                self.groups = groups or []
                self.traits = traits or {}
                self.entity = entity

        with patch.dict(
            "sys.modules",
            {
                "toggly": MagicMock(
                    TogglyClient=MagicMock,
                    TogglyConfig=MagicMock,
                    EvaluationContext=MockEvaluationContext,
                    FeatureRequirement=MagicMock(ALL="all", ANY="any"),
                    get_default_client=MagicMock(return_value=None),
                    set_default_client=MagicMock(),
                    AsyncTogglyClient=MagicMock,
                ),
            },
        ):
            from starlette.requests import Request

            from toggly_fastapi.middleware import get_context_from_request

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
                "state": {},
            }
            request = Request(mock_scope)

            # Set user on state
            mock_user = MagicMock()
            mock_user.id = 123
            mock_user.email = "test@example.com"
            request.state.user = mock_user

            context = get_context_from_request(request)

            assert context.identity == "123"
            assert context.traits.get("email") == "test@example.com"
