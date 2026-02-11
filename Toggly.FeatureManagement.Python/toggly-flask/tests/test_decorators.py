"""Tests for Flask decorators."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestFeatureFlagRequired:
    """Tests for feature_flag_required decorator."""

    def test_allows_access_when_enabled(self):
        """Test that access is allowed when feature is enabled."""
        from flask import Flask

        from toggly_flask.decorators import feature_flag_required

        app = Flask(__name__)
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        @app.route("/test")
        @feature_flag_required("my-feature")
        def test_view():
            return "success"

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/test")
                assert response.status_code == 200
                assert response.data == b"success"

    def test_returns_403_when_disabled(self):
        """Test that 403 is returned when feature is disabled."""
        from flask import Flask

        from toggly_flask.decorators import feature_flag_required

        app = Flask(__name__)
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        @app.route("/test")
        @feature_flag_required("my-feature")
        def test_view():
            return "success"

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/test")
                assert response.status_code == 403

    def test_redirects_when_redirect_url_provided(self):
        """Test that redirect happens when redirect_url is provided."""
        from flask import Flask

        from toggly_flask.decorators import feature_flag_required

        app = Flask(__name__)
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        @app.route("/test")
        @feature_flag_required("my-feature", redirect_url="/coming-soon/")
        def test_view():
            return "success"

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/test")
                assert response.status_code == 302
                assert response.location == "/coming-soon/"

    def test_calls_fallback_view(self):
        """Test that fallback view is called when provided."""
        from flask import Flask

        from toggly_flask.decorators import feature_flag_required

        app = Flask(__name__)
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        def fallback():
            return "fallback"

        @app.route("/test")
        @feature_flag_required("my-feature", fallback_view=fallback)
        def test_view():
            return "success"

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/test")
                assert response.status_code == 200
                assert response.data == b"fallback"

    def test_custom_status_code(self):
        """Test custom status code."""
        from flask import Flask

        from toggly_flask.decorators import feature_flag_required

        app = Flask(__name__)
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        @app.route("/test")
        @feature_flag_required("my-feature", status_code=404)
        def test_view():
            return "success"

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/test")
                assert response.status_code == 404


class TestFeatureGateRequired:
    """Tests for feature_gate_required decorator."""

    def test_allows_access_when_gate_passes(self):
        """Test that access is allowed when gate passes."""
        from flask import Flask

        from toggly_flask.decorators import feature_gate_required

        app = Flask(__name__)
        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True

        @app.route("/test")
        @feature_gate_required(["feature1", "feature2"])
        def test_view():
            return "success"

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/test")
                assert response.status_code == 200

    def test_returns_403_when_gate_fails(self):
        """Test that 403 is returned when gate fails."""
        from flask import Flask

        from toggly_flask.decorators import feature_gate_required

        app = Flask(__name__)
        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = False

        @app.route("/test")
        @feature_gate_required(["feature1", "feature2"])
        def test_view():
            return "success"

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/test")
                assert response.status_code == 403


class TestFeatureFlagSwitch:
    """Tests for feature_flag_switch function."""

    def test_calls_enabled_view_when_enabled(self):
        """Test that enabled view is called when feature is enabled."""
        from flask import Flask

        from toggly_flask.decorators import feature_flag_switch

        app = Flask(__name__)
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        def enabled_view():
            return "enabled"

        def disabled_view():
            return "disabled"

        app.add_url_rule(
            "/test",
            "test",
            feature_flag_switch("my-feature", enabled_view, disabled_view),
        )

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/test")
                assert response.data == b"enabled"

    def test_calls_disabled_view_when_disabled(self):
        """Test that disabled view is called when feature is disabled."""
        from flask import Flask

        from toggly_flask.decorators import feature_flag_switch

        app = Flask(__name__)
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        def enabled_view():
            return "enabled"

        def disabled_view():
            return "disabled"

        app.add_url_rule(
            "/test",
            "test",
            feature_flag_switch("my-feature", enabled_view, disabled_view),
        )

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/test")
                assert response.data == b"disabled"


class TestFeatureFlagBlueprint:
    """Tests for FeatureFlagBlueprint."""

    def test_routes_require_feature(self):
        """Test that blueprint routes require the feature."""
        from flask import Blueprint, Flask

        from toggly_flask.decorators import FeatureFlagBlueprint

        app = Flask(__name__)
        bp = Blueprint("beta", __name__)
        feature_bp = FeatureFlagBlueprint(bp, "beta-feature")

        @feature_bp.route("/new-page")
        def new_page():
            return "new page"

        app.register_blueprint(bp)

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/new-page")
                assert response.status_code == 403

    def test_allows_access_when_enabled(self):
        """Test that access is allowed when feature is enabled."""
        from flask import Blueprint, Flask

        from toggly_flask.decorators import FeatureFlagBlueprint

        app = Flask(__name__)
        bp = Blueprint("beta", __name__)
        feature_bp = FeatureFlagBlueprint(bp, "beta-feature")

        @feature_bp.route("/new-page")
        def new_page():
            return "new page"

        app.register_blueprint(bp)

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch("toggly_flask.decorators.get_client", return_value=mock_client):
            with app.test_client() as client:
                response = client.get("/new-page")
                assert response.status_code == 200
                assert response.data == b"new page"
