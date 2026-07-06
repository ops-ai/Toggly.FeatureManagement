"""Tests for FastAPI dependencies."""

import importlib
import sys
from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient

from tests.test_helpers import set_middleware_client


def _reload_modules():
    """Reload modules to apply patches."""
    # Clear cached modules
    modules_to_reload = [
        key
        for key in list(sys.modules.keys())
        if key.startswith("toggly_fastapi") or key.startswith("toggly")
    ]
    for mod in modules_to_reload:
        sys.modules.pop(mod, None)


class TestGetToggly:
    """Tests for get_toggly dependency."""

    def test_returns_helper_from_request_state(self):
        """Test that get_toggly returns helper from request state."""
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
            from fastapi import FastAPI

            from toggly_fastapi.dependencies import TogglyDep
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            @app.get("/test")
            async def test_endpoint(toggly: TogglyDep):
                return {"has_methods": hasattr(toggly, "is_enabled")}

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["has_methods"] is True

    def test_creates_helper_without_middleware(self):
        """Test that get_toggly creates helper if middleware not used."""
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
            from fastapi import FastAPI

            from toggly_fastapi.dependencies import TogglyDep

            app = FastAPI()

            @app.get("/test")
            async def test_endpoint(toggly: TogglyDep):
                return {"enabled": toggly.is_enabled("my-feature")}

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200


class TestRequireFeature:
    """Tests for require_feature dependency."""

    def test_allows_access_when_enabled(self):
        """Test that access is allowed when feature is enabled."""
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

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["message"] == "success"

    def test_returns_403_when_disabled(self):
        """Test that 403 is returned when feature is disabled."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

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

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 403

    def test_custom_status_code(self):
        """Test custom status code."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

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

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 404

    def test_custom_detail_message(self):
        """Test custom detail message."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.is_enabled.return_value = False

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

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 403
            assert response.json()["detail"] == "Coming soon!"


class TestRequireFeatures:
    """Tests for require_features dependency."""

    def test_allows_access_when_gate_passes(self):
        """Test that access is allowed when gate passes."""
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

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200

    def test_returns_403_when_gate_fails(self):
        """Test that 403 is returned when gate fails."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = False

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

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 403


class TestFeatureEnabled:
    """Tests for feature_enabled dependency."""

    def test_returns_feature_state(self):
        """Test that feature_enabled returns the feature state."""
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

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["enabled"] is True

    def test_uses_default_value(self):
        """Test that default value is used when client unavailable."""
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

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["enabled"] is True


class TestFeatureGateDependency:
    """Tests for FeatureGateDependency."""

    def test_checks_required_features(self):
        """Test that required features are checked."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True
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
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import FeatureGateDependency
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            gate = FeatureGateDependency(required=["base-feature"])

            @app.get("/test")
            async def test_endpoint(features: dict = Depends(gate)):
                return features

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert "base-feature" in response.json()

    def test_raises_when_required_missing(self):
        """Test that HTTPException is raised when required features are missing."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = False

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
            from fastapi import Depends, FastAPI

            from toggly_fastapi.dependencies import FeatureGateDependency
            from toggly_fastapi.middleware import TogglyMiddleware

            app = FastAPI()
            app.add_middleware(TogglyMiddleware)

            gate = FeatureGateDependency(required=["missing-feature"])

            @app.get("/test")
            async def test_endpoint(features: dict = Depends(gate)):
                return features

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 403

    def test_includes_optional_features(self):
        """Test that optional features are included in result."""
        _reload_modules()

        mock_client = MagicMock()
        mock_client.evaluate_gate.return_value = True
        mock_client.is_enabled.side_effect = lambda key, *args, **kwargs: key == "optional1"

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

            set_middleware_client(mock_client)
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
        _reload_modules()

        # Create a proper EvaluationContext mock
        class MockEvaluationContext:
            def __init__(self, identity=None, groups=None, traits=None):
                self.identity = identity
                self.groups = groups or []
                self.traits = traits or {}

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
            from fastapi import FastAPI

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

            set_middleware_client(mock_client)
            client = TestClient(app)
            response = client.get("/test")
            assert response.status_code == 200
            assert response.json()["has_traits"] is True
            assert response.json()["path"] == "/test"
