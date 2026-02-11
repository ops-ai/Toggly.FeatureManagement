"""Tests for Django view decorators."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestFeatureFlagRequired:
    """Tests for feature_flag_required decorator."""

    def test_allows_access_when_enabled(self):
        """Test that access is allowed when feature is enabled."""
        from toggly_django.decorators import feature_flag_required

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        @feature_flag_required("my-feature")
        def my_view(request):
            return "success"

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.decorators.get_client", return_value=mock_client):
            result = my_view(mock_request)
            assert result == "success"

    def test_returns_403_when_disabled(self):
        """Test that 403 is returned when feature is disabled."""
        from django.http import HttpResponseForbidden

        from toggly_django.decorators import feature_flag_required

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        @feature_flag_required("my-feature")
        def my_view(request):
            return "success"

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.decorators.get_client", return_value=mock_client):
            result = my_view(mock_request)
            assert isinstance(result, HttpResponseForbidden)

    def test_redirects_when_redirect_url_provided(self):
        """Test that redirect happens when redirect_url is provided."""
        from django.http import HttpResponseRedirect

        from toggly_django.decorators import feature_flag_required

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        @feature_flag_required("my-feature", redirect_url="/coming-soon/")
        def my_view(request):
            return "success"

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.decorators.get_client", return_value=mock_client):
            result = my_view(mock_request)
            assert isinstance(result, HttpResponseRedirect)
            assert result.url == "/coming-soon/"

    def test_calls_fallback_view_when_provided(self):
        """Test that fallback view is called when provided."""
        from toggly_django.decorators import feature_flag_required

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        def fallback(request):
            return "fallback"

        @feature_flag_required("my-feature", fallback_view=fallback)
        def my_view(request):
            return "success"

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.decorators.get_client", return_value=mock_client):
            result = my_view(mock_request)
            assert result == "fallback"


class TestFeatureGateRequired:
    """Tests for feature_gate_required decorator."""

    def test_allows_access_when_all_enabled(self):
        """Test that access is allowed when all features are enabled."""
        from toggly_django.decorators import feature_gate_required

        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True

        @feature_gate_required(["feature1", "feature2"])
        def my_view(request):
            return "success"

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.decorators.get_client", return_value=mock_client):
            result = my_view(mock_request)
            assert result == "success"

    def test_returns_403_when_gate_fails(self):
        """Test that 403 is returned when gate fails."""
        from django.http import HttpResponseForbidden

        from toggly_django.decorators import feature_gate_required

        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = False

        @feature_gate_required(["feature1", "feature2"])
        def my_view(request):
            return "success"

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.decorators.get_client", return_value=mock_client):
            result = my_view(mock_request)
            assert isinstance(result, HttpResponseForbidden)


class TestFeatureFlagSwitch:
    """Tests for feature_flag_switch decorator."""

    def test_calls_enabled_view_when_enabled(self):
        """Test that enabled view is called when feature is enabled."""
        from toggly_django.decorators import feature_flag_switch

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        def enabled_view(request):
            return "enabled"

        def disabled_view(request):
            return "disabled"

        view = feature_flag_switch("my-feature", enabled_view, disabled_view)

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.decorators.get_client", return_value=mock_client):
            result = view(mock_request)
            assert result == "enabled"

    def test_calls_disabled_view_when_disabled(self):
        """Test that disabled view is called when feature is disabled."""
        from toggly_django.decorators import feature_flag_switch

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        def enabled_view(request):
            return "enabled"

        def disabled_view(request):
            return "disabled"

        view = feature_flag_switch("my-feature", enabled_view, disabled_view)

        mock_request = MagicMock()
        mock_request.path = "/test"
        mock_request.method = "GET"
        mock_request.META = {"REMOTE_ADDR": "127.0.0.1"}
        mock_request.user = MagicMock()
        mock_request.user.is_authenticated = False

        with patch("toggly_django.decorators.get_client", return_value=mock_client):
            result = view(mock_request)
            assert result == "disabled"
