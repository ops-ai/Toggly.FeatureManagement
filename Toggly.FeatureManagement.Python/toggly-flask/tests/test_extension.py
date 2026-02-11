"""Tests for Flask extension."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestTogglyExtension:
    """Tests for Toggly Flask extension."""

    def test_init_with_app(self):
        """Test initialization with Flask app."""
        with patch("toggly_flask.extension.TogglyClient") as MockClient:
            mock_instance = MagicMock()
            MockClient.return_value = mock_instance

            from flask import Flask

            from toggly_flask.extension import Toggly

            app = Flask(__name__)
            app.config["TOGGLY_APP_KEY"] = "test-key"

            with patch("toggly_flask.extension.set_default_client"):
                toggly = Toggly(app)

                assert "toggly" in app.extensions
                assert app.extensions["toggly"] is toggly

    def test_init_app_factory_pattern(self):
        """Test initialization with factory pattern."""
        with patch("toggly_flask.extension.TogglyClient") as MockClient:
            mock_instance = MagicMock()
            MockClient.return_value = mock_instance

            from flask import Flask

            from toggly_flask.extension import Toggly

            app = Flask(__name__)
            app.config["TOGGLY_APP_KEY"] = "test-key"

            with patch("toggly_flask.extension.set_default_client"):
                toggly = Toggly()
                toggly.init_app(app)

                assert "toggly" in app.extensions

    def test_uses_provided_client(self):
        """Test that a provided client is used instead of creating one."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        assert toggly.client is mock_client

    def test_is_enabled_calls_client(self):
        """Test is_enabled delegates to client."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.test_request_context("/"):
            result = toggly.is_enabled("my-feature")
            assert result is True
            mock_client.is_enabled.assert_called()

    def test_is_enabled_returns_default_without_client(self):
        """Test is_enabled returns default when no client."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        app = Flask(__name__)
        toggly = Toggly(app, client=None)
        toggly._client = None  # Force no client

        result = toggly.is_enabled("my-feature", default=True)
        assert result is True

    def test_is_disabled_negates_is_enabled(self):
        """Test is_disabled returns opposite of is_enabled."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.test_request_context("/"):
            result = toggly.is_disabled("my-feature")
            assert result is False

    def test_evaluate_gate(self):
        """Test evaluate_gate delegates to client."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.test_request_context("/"):
            result = toggly.evaluate_gate(["feature1", "feature2"])
            assert result is True
            mock_client.evaluate_gate.assert_called()

    def test_flags_property(self):
        """Test flags property returns feature flags."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()
        mock_client.feature_flags = {"feature1": True, "feature2": False}

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        assert toggly.flags == {"feature1": True, "feature2": False}

    def test_before_request_sets_g_toggly(self):
        """Test before_request handler sets g.toggly."""
        from flask import Flask, g

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.test_request_context("/"):
            # Simulate before_request
            app.preprocess_request()
            assert hasattr(g, "toggly")


class TestTogglyRequestHelper:
    """Tests for TogglyRequestHelper."""

    def test_is_enabled(self):
        """Test is_enabled method."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.test_request_context("/"):
            app.preprocess_request()
            from flask import g

            result = g.toggly.is_enabled("my-feature")
            assert result is True

    def test_context_is_cached(self):
        """Test that context is cached."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.test_request_context("/"):
            app.preprocess_request()
            from flask import g

            context1 = g.toggly.context
            context2 = g.toggly.context
            assert context1 is context2


class TestTemplateToggly:
    """Tests for TemplateToggly."""

    def test_is_enabled_attribute_access(self):
        """Test is_enabled attribute-style access."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.test_request_context("/"):
            # Get template context
            context = toggly._context_processor()
            template_toggly = context["toggly"]

            # Access via attribute (underscores converted to hyphens)
            result = template_toggly.is_enabled.my_feature
            assert result is True

    def test_is_disabled_attribute_access(self):
        """Test is_disabled attribute-style access."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.test_request_context("/"):
            context = toggly._context_processor()
            template_toggly = context["toggly"]

            result = template_toggly.is_disabled.my_feature
            assert result is False

    def test_flags_property(self):
        """Test flags property in template context."""
        from flask import Flask

        from toggly_flask.extension import Toggly

        mock_client = MagicMock()
        mock_client.feature_flags = {"feature1": True}

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.test_request_context("/"):
            context = toggly._context_processor()
            template_toggly = context["toggly"]

            assert template_toggly.flags == {"feature1": True}


class TestGetContextFromRequest:
    """Tests for get_context_from_request function."""

    def test_extracts_request_metadata(self):
        """Test extraction of request metadata."""
        from flask import Flask

        from toggly_flask.extension import get_context_from_request

        app = Flask(__name__)

        with app.test_request_context("/api/test", method="POST"):
            context = get_context_from_request()

            assert context.traits["path"] == "/api/test"
            assert context.traits["method"] == "POST"

    def test_extracts_flask_login_user(self):
        """Test extraction of Flask-Login user."""
        from flask import Flask

        from toggly_flask.extension import get_context_from_request

        app = Flask(__name__)

        with app.test_request_context("/"):
            # Mock Flask-Login current_user - patch at the flask_login module level
            mock_user = MagicMock()
            mock_user.is_authenticated = True
            mock_user.id = 123
            mock_user.email = "test@example.com"
            mock_user.roles = None

            with patch.dict("sys.modules", {"flask_login": MagicMock(current_user=mock_user)}):
                context = get_context_from_request()

                assert context.identity == "123"
                assert context.traits.get("email") == "test@example.com"


class TestGetToggly:
    """Tests for get_toggly function."""

    def test_returns_extension_from_current_app(self):
        """Test that get_toggly returns the extension."""
        from flask import Flask

        from toggly_flask.extension import Toggly, get_toggly

        mock_client = MagicMock()

        app = Flask(__name__)
        toggly = Toggly(app, client=mock_client)

        with app.app_context():
            result = get_toggly()
            assert result is toggly


class TestGetClient:
    """Tests for get_client function."""

    def test_returns_client_from_default(self):
        """Test that get_client returns the default client."""
        mock_client = MagicMock()

        with patch("toggly_flask.extension.get_default_client", return_value=mock_client):
            from toggly_flask.extension import get_client

            result = get_client()
            assert result is mock_client
