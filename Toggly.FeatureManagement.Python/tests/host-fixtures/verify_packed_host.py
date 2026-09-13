"""Install packed Python SDK wheels into a disposable real framework host."""

import argparse
import asyncio
import os
import subprocess
import sys
import tempfile
import venv
from importlib.metadata import version
from pathlib import Path


def parse_args() -> argparse.Namespace:
    """Parse the host version and execution mode."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel-dir", type=Path, required=True)
    parser.add_argument("--django-version", required=True)
    parser.add_argument(
        "--frameworks",
        default="all",
        choices=("core,django", "all"),
        help="Install the retained core/Django pair or the complete current host.",
    )
    parser.add_argument("--verify", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def wheel_for(wheel_dir: Path, package: str) -> Path:
    """Return exactly one wheel for a project built by the workflow."""
    prefix = package.replace("-", "_") + "-"
    matches = sorted(wheel_dir.glob(f"{prefix}*.whl"))
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected one {package} wheel in {wheel_dir}, found {matches}"
        )
    return matches[0]


def venv_python(venv_dir: Path) -> Path:
    """Return the platform-specific Python executable in a virtual environment."""
    return venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def bootstrap(args: argparse.Namespace) -> None:
    """Create an isolated consumer, install wheels, then run its real host checks."""
    wheel_dir = args.wheel_dir.resolve()
    if not wheel_dir.is_dir():
        raise RuntimeError(f"Wheel directory does not exist: {wheel_dir}")

    with tempfile.TemporaryDirectory(prefix="toggly-packed-python-host-") as temp_dir:
        environment = Path(temp_dir) / "venv"
        venv.EnvBuilder(with_pip=True, clear=True).create(environment)
        python = venv_python(environment)

        packages = [
            str(wheel_for(wheel_dir, "toggly")),
            str(wheel_for(wheel_dir, "toggly-django")),
            f"django=={args.django_version}",
        ]
        if args.frameworks == "all":
            packages.extend(
                [
                    str(wheel_for(wheel_dir, "toggly-flask")),
                    str(wheel_for(wheel_dir, "toggly-fastapi")),
                    str(wheel_for(wheel_dir, "toggly-cache")),
                    "flask==3.1.*",
                    "fastapi==0.141.1",
                    "httpx>=0.24.0",
                    "redis==8.1.*",
                    "websocket-client>=1.6.0",
                    "grpcio>=1.80.0",
                    "protobuf>=4.25.0",
                ]
            )

        subprocess.run([str(python), "-m", "pip", "install", *packages], check=True)
        subprocess.run(
            [
                str(python),
                str(Path(__file__).resolve()),
                "--wheel-dir",
                str(wheel_dir),
                "--django-version",
                args.django_version,
                "--frameworks",
                args.frameworks,
                "--verify",
            ],
            check=True,
            env=os.environ.copy(),
        )


def assert_installed(module: object) -> None:
    """Reject a source-tree import: checks must execute installed packed artifacts."""
    module_file = getattr(module, "__file__", None)
    if module_file is None or "site-packages" not in Path(module_file).parts:
        raise AssertionError(f"Expected installed package import, got {module_file!r}")


def assert_distribution_version(project: str, module: object) -> None:
    """Keep the exported package version aligned with its installed wheel."""
    exported_version = getattr(module, "__version__", None)
    if exported_version != version(project):
        raise AssertionError(
            f"{project} exports {exported_version!r}, wheel metadata is {version(project)!r}"
        )


def verify_core() -> None:
    """Exercise local evaluation from the packed zero-dependency core."""
    import toggly
    from toggly import TogglyClient, TogglyConfig

    assert_installed(toggly)
    assert_distribution_version("toggly", toggly)
    client = TogglyClient(
        TogglyConfig(
            feature_defaults={"packed-core": True},
            refresh_interval=0,
            disable_background_refresh=True,
            enable_live_updates=False,
            enable_usage_tracking=False,
            enable_metrics=False,
        )
    )
    try:
        client.init()
        assert client.is_enabled("packed-core") is True
        assert client.is_enabled("missing") is False
    finally:
        client.close()


def verify_django() -> None:
    """Exercise Django middleware from the installed integration wheel."""
    from django.conf import settings

    if not settings.configured:
        settings.configure(
            SECRET_KEY="packed-host-only",
            ROOT_URLCONF=__name__,
            INSTALLED_APPS=["toggly_django"],
            TOGGLY={
                "FEATURE_DEFAULTS": {"packed-django": True},
                "REFRESH_INTERVAL": 0,
                "DISABLE_BACKGROUND_REFRESH": True,
                "ENABLE_LIVE_UPDATES": False,
                "ENABLE_USAGE_TRACKING": False,
            },
        )
    import django

    django.setup()
    import toggly_django
    from django.http import HttpResponse
    from django.test import RequestFactory
    from toggly_django.middleware import TogglyMiddleware

    assert_installed(toggly_django)
    assert_distribution_version("toggly-django", toggly_django)
    request = RequestFactory().get("/packed-django")
    response = TogglyMiddleware(lambda _: HttpResponse("ok"))(request)
    assert response.status_code == 200
    assert request.toggly.is_enabled("packed-django") is True


def verify_current_optional_hosts() -> None:
    """Exercise current Flask, FastAPI, Redis, WebSocket, and gRPC dependencies."""
    import grpc
    import httpx
    import redis
    import toggly_cache
    import toggly_fastapi
    import toggly_flask
    import websocket
    from fastapi import FastAPI, Request
    from flask import Flask, g
    from toggly import FeatureDefinition
    from toggly_cache import RedisSnapshotProvider
    from toggly_fastapi import TogglyMiddleware, configure_toggly
    from toggly_flask import Toggly

    for module in (toggly_cache, toggly_fastapi, toggly_flask):
        assert_installed(module)
    assert_distribution_version("toggly-cache", toggly_cache)
    assert_distribution_version("toggly-fastapi", toggly_fastapi)
    assert_distribution_version("toggly-flask", toggly_flask)
    assert grpc.__version__
    assert websocket.__version__

    flask_app = Flask(__name__)
    flask_app.config.update(
        TOGGLY_FEATURE_DEFAULTS={"packed-flask": True},
        TOGGLY_REFRESH_INTERVAL=0,
        TOGGLY_DISABLE_BACKGROUND_REFRESH=True,
        TOGGLY_ENABLE_USAGE_TRACKING=False,
    )
    Toggly(flask_app)
    with flask_app.test_request_context("/packed-flask"):
        flask_app.preprocess_request()
        assert g.toggly.is_enabled("packed-flask") is True

    fastapi_app = FastAPI()
    client = configure_toggly(
        feature_defaults={"packed-fastapi": True},
        refresh_interval=0,
        disable_background_refresh=True,
        enable_usage_tracking=False,
    )
    fastapi_app.add_middleware(TogglyMiddleware)

    @fastapi_app.get("/packed-fastapi")
    async def packed_fastapi(request: Request) -> dict[str, bool]:
        return {"enabled": request.state.toggly.is_enabled("packed-fastapi")}

    try:

        async def request_fastapi_host() -> httpx.Response:
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://packed-host"
            ) as http:
                return await http.get("/packed-fastapi")

        response = asyncio.run(request_fastapi_host())
        assert response.status_code == 200, response.text
        assert response.json() == {"enabled": True}
    finally:
        client.close()

    redis_url = os.environ.get("TOGGLY_REDIS_URL", "redis://127.0.0.1:6379/15")
    redis_client = redis.Redis.from_url(redis_url)
    redis_client.ping()
    provider = RedisSnapshotProvider(client=redis_client, prefix="toggly-packed-host:")
    try:
        provider.save(
            "packed-app", "Production", [FeatureDefinition(feature_key="packed-cache")]
        )
        definitions = provider.load("packed-app", "Production")
        assert definitions is not None
        assert [definition.feature_key for definition in definitions] == [
            "packed-cache"
        ]
    finally:
        provider.delete("packed-app", "Production")
        provider.close()


def verify(args: argparse.Namespace) -> None:
    """Run the installed-wheel behavior checks for the selected framework host."""
    verify_core()
    verify_django()
    if args.frameworks == "all":
        verify_current_optional_hosts()
    print(
        "PACKED_PYTHON_HOST_PASS "
        f"python={sys.version_info.major}.{sys.version_info.minor} "
        f"django={args.django_version} frameworks={args.frameworks}"
    )


def main() -> None:
    """Dispatch bootstrap or installed-wheel verification."""
    args = parse_args()
    if args.verify:
        verify(args)
    else:
        bootstrap(args)


if __name__ == "__main__":
    main()
