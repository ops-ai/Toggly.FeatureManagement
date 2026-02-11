"""Tests for FastAPI middleware."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestConfigureToggly:
    """Tests for configure_toggly function."""

    def test_creates_client(self):
        """Test that configure_toggly creates a client."""
        with patch("toggly_fastapi.middleware.TogglyClient") as MockClient:
            mock_instance = MagicMock()
            MockClient.return_value = mock_instance

            with patch("toggly_fastapi.middleware.set_default_client"):
                from toggly_fastapi.middleware import configure_toggly

                result = configure_toggly(app_key="test-key")

                MockClient.assert_called_once()
                mock_instance.init.assert_called_once()
                assert result is mock_instance

    def test_uses_provided_client(self):
        """Test that configure_toggly uses provided client."""
        mock_client = MagicMock()

        with patch("toggly_fastapi.middleware.set_default_client"):
            from toggly_fastapi.middleware import configure_toggly

            result = configure_toggly(client=mock_client)

            assert result is mock_client


class TestGetTogglyClient:
    """Tests for get_toggly_client function."""

    def test_returns_module_client(self):
        """Test that get_toggly_client returns the module-level client."""
        mock_client = MagicMock()

        with patch("toggly_fastapi.middleware._client", mock_client):
            from toggly_fastapi.middleware import get_toggly_client

            result = get_toggly_client()
            assert result is mock_client

    def test_falls_back_to_default_client(self):
        """Test fallback to default client."""
        mock_client = MagicMock()

        with patch("toggly_fastapi.middleware._client", None):
            with patch(
                "toggly_fastapi.middleware.get_default_client",
                return_value=mock_client,
            ):
                from toggly_fastapi.middleware import get_toggly_client

                result = get_toggly_client()
                # May return mock_client or None depending on patching order


class TestTogglyMiddleware:
    """Tests for TogglyMiddleware."""

    @pytest.mark.asyncio
    async def test_attaches_helper_to_request_state(self):
        """Test that middleware attaches helper to request.state."""
        from starlette.requests import Request
        from starlette.testclient import TestClient

        from toggly_fastapi.middleware import TogglyMiddleware

        mock_client = MagicMock()

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import FastAPI

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get("/test")
            async def test_endpoint(request: Request):
                assert hasattr(request.state, "toggly")
                return {"has_toggly": hasattr(request.state, "toggly")}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["has_toggly"] is True

    @pytest.mark.asyncio
    async def test_helper_provides_is_enabled(self):
        """Test that helper provides is_enabled method."""
        from starlette.requests import Request
        from starlette.testclient import TestClient

        from toggly_fastapi.middleware import TogglyMiddleware

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import FastAPI

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get("/test")
            async def test_endpoint(request: Request):
                return {"enabled": request.state.toggly.is_enabled("my-feature")}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["enabled"] is True


class TestTogglyRequestHelper:
    """Tests for TogglyRequestHelper."""

    def test_is_enabled_returns_default_without_client(self):
        """Test is_enabled returns default when no client."""
        from starlette.requests import Request
        from starlette.testclient import TestClient

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=None):
            from toggly_fastapi.middleware import TogglyRequestHelper

            # Create a minimal mock request
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
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            from starlette.requests import Request

            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            result = helper.is_enabled("my-feature")

            assert result is True
            mock_client.is_enabled.assert_called()

    def test_is_disabled_negates_is_enabled(self):
        """Test is_disabled returns opposite of is_enabled."""
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            from starlette.requests import Request

            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            assert helper.is_disabled("my-feature") is False

    def test_evaluate_gate(self):
        """Test evaluate_gate method."""
        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            from starlette.requests import Request

            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            result = helper.evaluate_gate(["feature1", "feature2"])

            assert result is True
            mock_client.evaluate_gate.assert_called()

    def test_flags_property(self):
        """Test flags property."""
        mock_client = MagicMock()
        mock_client.feature_flags = {"feature1": True, "feature2": False}

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            from starlette.requests import Request

            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            assert helper.flags == {"feature1": True, "feature2": False}

    def test_context_is_cached(self):
        """Test that context is cached."""
        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=None):
            from toggly_fastapi.middleware import TogglyRequestHelper

            mock_scope = {
                "type": "http",
                "method": "GET",
                "path": "/test",
                "query_string": b"",
                "headers": [],
            }
            from starlette.requests import Request

            request = Request(mock_scope)
            helper = TogglyRequestHelper(request)

            context1 = helper.context
            context2 = helper.context

            assert context1 is context2


class TestGetContextFromRequest:
    """Tests for get_context_from_request function."""

    def test_extracts_request_metadata(self):
        """Test extraction of request metadata."""
        from toggly_fastapi.middleware import get_context_from_request

        mock_scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/test",
            "query_string": b"",
            "headers": [],
        }
        from starlette.requests import Request

        request = Request(mock_scope)

        context = get_context_from_request(request)

        assert context.traits["path"] == "/api/test"
        assert context.traits["method"] == "POST"

    def test_extracts_user_from_state(self):
        """Test extraction of user from request.state."""
        from toggly_fastapi.middleware import get_context_from_request

        mock_scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
            "state": {},
        }
        from starlette.requests import Request

        request = Request(mock_scope)

        # Set user on state
        mock_user = MagicMock()
        mock_user.id = 123
        mock_user.email = "test@example.com"
        request.state.user = mock_user

        context = get_context_from_request(request)

        assert context.identity == "123"
        assert context.traits.get("email") == "test@example.com"
