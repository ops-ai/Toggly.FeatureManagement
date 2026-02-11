"""Tests for Django utility functions."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestGetClient:
    """Tests for get_client function."""

    def test_get_client_returns_default(self):
        """Test that get_client returns the default client."""
        mock_client = MagicMock()

        with patch("toggly_django.utils.get_default_client", return_value=mock_client):
            from toggly_django.utils import get_client

            assert get_client() is mock_client

    def test_get_client_returns_none_when_not_configured(self):
        """Test that get_client returns None when not configured."""
        with patch("toggly_django.utils.get_default_client", return_value=None):
            from toggly_django.utils import get_client

            assert get_client() is None


class TestGetContextFromRequest:
    """Tests for get_context_from_request function."""

    def test_creates_context_from_request(self):
        """Test context creation from request."""
        from toggly_django.utils import get_context_from_request

        mock_request = MagicMock()
        mock_request.path = "/test/path"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        context = get_context_from_request(mock_request)

        assert context.traits["path"] == "/test/path"
        assert context.traits["method"] == "GET"
        assert context.traits["remote_addr"] == "127.0.0.1"

    def test_extracts_user_identity(self):
        """Test extraction of user identity."""
        from toggly_django.utils import get_context_from_request

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = True
        mock_request.user.pk = 123
        mock_request.user.email = "test@example.com"
        mock_request.user.groups = MagicMock()
        mock_request.user.groups.all.return_value = []

        context = get_context_from_request(mock_request)

        assert context.identity == "123"
        assert context.traits["email"] == "test@example.com"

    def test_extracts_user_groups(self):
        """Test extraction of user groups."""
        from toggly_django.utils import get_context_from_request

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = True
        mock_request.user.pk = 123

        # Mock groups using values_list (primary approach)
        mock_request.user.groups = MagicMock()
        mock_request.user.groups.values_list.return_value = ["admins", "editors"]

        context = get_context_from_request(mock_request)

        assert "admins" in context.groups
        assert "editors" in context.groups

    def test_handles_anonymous_user(self):
        """Test handling of anonymous users."""
        from toggly_django.utils import get_context_from_request

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        context = get_context_from_request(mock_request)

        assert context.identity is None


class TestConfigureToggly:
    """Tests for configure_toggly function."""

    def test_creates_client_from_settings(self):
        """Test client creation from Django settings."""
        mock_settings = MagicMock()
        mock_settings.TOGGLY_APP_KEY = "test-key"
        mock_settings.TOGGLY_ENVIRONMENT = "Production"

        with patch("toggly_django.utils.django_settings", mock_settings):
            with patch("toggly_django.utils.TogglyClient") as MockClient:
                with patch("toggly_django.utils.set_default_client"):
                    mock_instance = MagicMock()
                    MockClient.return_value = mock_instance

                    from toggly_django.utils import configure_toggly

                    result = configure_toggly()

                    MockClient.assert_called_once()
                    mock_instance.init.assert_called_once()

    def test_uses_existing_client(self):
        """Test using an existing client."""
        mock_client = MagicMock()

        with patch("toggly_django.utils.set_default_client"):
            from toggly_django.utils import configure_toggly

            result = configure_toggly(client=mock_client)

            assert result is mock_client
