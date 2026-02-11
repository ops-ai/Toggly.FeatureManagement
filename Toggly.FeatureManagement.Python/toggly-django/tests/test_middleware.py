"""Tests for Django middleware."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestTogglyMiddleware:
    """Tests for TogglyMiddleware."""

    def test_attaches_toggly_to_request(self):
        """Test that middleware attaches toggly helper to request."""
        from toggly_django.middleware import TogglyMiddleware

        mock_get_response = MagicMock(return_value=MagicMock())
        middleware = TogglyMiddleware(mock_get_response)

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        middleware(mock_request)

        assert hasattr(mock_request, "toggly")
        mock_get_response.assert_called_once_with(mock_request)

    def test_toggly_helper_provides_feature_checks(self):
        """Test that the attached helper provides feature checking."""
        from toggly_django.middleware import TogglyMiddleware

        mock_get_response = MagicMock(return_value=MagicMock())
        middleware = TogglyMiddleware(mock_get_response)

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        middleware(mock_request)

        # Check that the helper has expected methods
        assert hasattr(mock_request.toggly, "is_enabled")
        assert hasattr(mock_request.toggly, "is_disabled")
        assert hasattr(mock_request.toggly, "context")

    def test_helper_uses_request_context(self):
        """Test that helper creates context from request."""
        from toggly_django.middleware import TogglyMiddleware

        mock_get_response = MagicMock(return_value=MagicMock())
        middleware = TogglyMiddleware(mock_get_response)

        mock_request = MagicMock()
        mock_request.path = "/api/users"
        mock_request.method = "POST"
        mock_request.META = {"REMOTE_ADDR": "192.168.1.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = True
        mock_request.user.pk = 42
        mock_request.user.groups = MagicMock()
        mock_request.user.groups.all.return_value = []

        middleware(mock_request)

        # Access the context
        context = mock_request.toggly.context
        assert context.traits["path"] == "/api/users"
        assert context.traits["method"] == "POST"


class TestTogglyRequestHelper:
    """Tests for TogglyRequestHelper."""

    def test_is_enabled_returns_default_without_client(self):
        """Test is_enabled returns default when client is None."""
        from toggly_django.middleware import TogglyRequestHelper

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.middleware.get_client", return_value=None):
            helper = TogglyRequestHelper(mock_request)

            assert helper.is_enabled("some-feature") is False
            assert helper.is_enabled("some-feature", default=True) is True

    def test_is_enabled_calls_client(self):
        """Test is_enabled calls the client."""
        from toggly_django.middleware import TogglyRequestHelper

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch("toggly_django.middleware.get_client", return_value=mock_client):
            helper = TogglyRequestHelper(mock_request)
            result = helper.is_enabled("my-feature")

            assert result is True
            mock_client.is_enabled.assert_called_once()

    def test_is_disabled_negates_is_enabled(self):
        """Test is_disabled is opposite of is_enabled."""
        from toggly_django.middleware import TogglyRequestHelper

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch("toggly_django.middleware.get_client", return_value=mock_client):
            helper = TogglyRequestHelper(mock_request)

            assert helper.is_disabled("my-feature") is False

    def test_context_is_cached(self):
        """Test that context is computed once and cached."""
        from toggly_django.middleware import TogglyRequestHelper

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.middleware.get_client", return_value=None):
            helper = TogglyRequestHelper(mock_request)

            # Access context twice
            context1 = helper.context
            context2 = helper.context

            # Should be the same object
            assert context1 is context2
