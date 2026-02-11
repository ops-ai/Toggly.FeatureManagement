"""Tests for FastAPI dependencies."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient


class TestGetToggly:
    """Tests for get_toggly dependency."""

    def test_returns_helper_from_request_state(self):
        """Test that get_toggly returns helper from request state."""
        from toggly_fastapi.middleware import TogglyMiddleware

        mock_client = MagicMock()

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import FastAPI

            from toggly_fastapi.dependencies import TogglyDep, get_toggly

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get("/test")
            async def test_endpoint(toggly: TogglyDep):
                return {"has_methods": hasattr(toggly, "is_enabled")}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["has_methods"] is True

    def test_creates_helper_without_middleware(self):
        """Test that get_toggly creates helper if middleware not used."""
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            with patch("toggly_fastapi.middleware.get_current_toggly", return_value=None):
                from fastapi import FastAPI

                from toggly_fastapi.dependencies import TogglyDep

                app = FastAPI()

                @app.get("/test")
                async def test_endpoint(toggly: TogglyDep):
                    return {"enabled": toggly.is_enabled("my-feature")}

                client = TestClient(app)
                response = client.get("/test")
                assert response.status_code == 200


class TestRequireFeature:
    """Tests for require_feature dependency."""

    def test_allows_access_when_enabled(self):
        """Test that access is allowed when feature is enabled."""
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import require_feature
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get(
                "/test",
                dependencies=[Depends(require_feature("my-feature"))],
            )
            async def test_endpoint():
                return {"message": "success"}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["message"] == "success"

    def test_returns_403_when_disabled(self):
        """Test that 403 is returned when feature is disabled."""
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import require_feature
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get(
                "/test",
                dependencies=[Depends(require_feature("my-feature"))],
            )
            async def test_endpoint():
                return {"message": "success"}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 403

    def test_custom_status_code(self):
        """Test custom status code."""
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import require_feature
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get(
                "/test",
                dependencies=[Depends(require_feature("my-feature", status_code=404))],
            )
            async def test_endpoint():
                return {"message": "success"}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 404

    def test_custom_detail_message(self):
        """Test custom detail message."""
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import require_feature
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get(
                "/test",
                dependencies=[
                    Depends(require_feature("my-feature", detail="Coming soon!"))
                ],
            )
            async def test_endpoint():
                return {"message": "success"}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 403
            assert response.json()["detail"] == "Coming soon!"


class TestRequireFeatures:
    """Tests for require_features dependency."""

    def test_allows_access_when_gate_passes(self):
        """Test that access is allowed when gate passes."""
        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import require_features
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get(
                "/test",
                dependencies=[Depends(require_features(["feature1", "feature2"]))],
            )
            async def test_endpoint():
                return {"message": "success"}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200

    def test_returns_403_when_gate_fails(self):
        """Test that 403 is returned when gate fails."""
        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = False

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import require_features
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get(
                "/test",
                dependencies=[Depends(require_features(["feature1", "feature2"]))],
            )
            async def test_endpoint():
                return {"message": "success"}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 403


class TestFeatureEnabled:
    """Tests for feature_enabled dependency."""

    def test_returns_feature_state(self):
        """Test that feature_enabled returns the feature state."""
        mock_client = MagicMock()
        mock_client.is_enabled.return_value = True

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import feature_enabled
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get("/test")
            async def test_endpoint(
                is_enabled: bool = Depends(feature_enabled("my-feature")),
            ):
                return {"enabled": is_enabled}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["enabled"] is True

    def test_uses_default_value(self):
        """Test that default value is used when client unavailable."""
        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=None):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import feature_enabled
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get("/test")
            async def test_endpoint(
                is_enabled: bool = Depends(feature_enabled("my-feature", default=True)),
            ):
                return {"enabled": is_enabled}

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["enabled"] is True


class TestFeatureGateDependency:
    """Tests for FeatureGateDependency."""

    def test_checks_required_features(self):
        """Test that required features are checked."""
        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True
        mock_client.is_enabled.return_value = True

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import FeatureGateDependency
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            gate = FeatureGateDependency(required=["base-feature"])

            @app.get("/test")
            async def test_endpoint(features: dict = Depends(gate)):
                return features

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert "base-feature" in response.json()

    def test_raises_when_required_missing(self):
        """Test that HTTPException is raised when required features are missing."""
        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = False

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import FeatureGateDependency
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            gate = FeatureGateDependency(required=["missing-feature"])

            @app.get("/test")
            async def test_endpoint(features: dict = Depends(gate)):
                return features

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 403

    def test_includes_optional_features(self):
        """Test that optional features are included in result."""
        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True
        mock_client.is_enabled.side_effect = lambda key, *args, **kwargs: key == "optional1"

        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=mock_client):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import FeatureGateDependency
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            gate = FeatureGateDependency(
                required=["base"],
                optional=["optional1", "optional2"],
            )

            @app.get("/test")
            async def test_endpoint(features: dict = Depends(gate)):
                return features

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            data = response.json()
            assert "optional1" in data
            assert "optional2" in data


class TestGetEvaluationContext:
    """Tests for get_evaluation_context dependency."""

    def test_returns_context(self):
        """Test that get_evaluation_context returns a context."""
        with patch("toggly_fastapi.middleware.get_toggly_client", return_value=None):
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import ContextDep
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get("/test")
            async def test_endpoint(context: ContextDep):
                return {
                    "has_traits": bool(context.traits),
                    "path": context.traits.get("path"),
                }

            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["has_traits"] is True
            assert response.json()["path"] == "/test"
