"""Pytest configuration for toggly-django tests."""

import sys
from pathlib import Path

# Add tests directory to path so Django can find settings
tests_dir = Path(__file__).parent
if str(tests_dir.parent) not in sys.path:
    sys.path.insert(0, str(tests_dir.parent))

import django
from django.conf import settings

# Configure Django settings before any imports
if not settings.configured:
    settings.configure(
        DEBUG=True,
        DATABASES={
            "default": {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": ":memory:",
            }
        },
        INSTALLED_APPS=[
            "django.contrib.contenttypes",
            "django.contrib.auth",
            "toggly_django",
        ],
        ROOT_URLCONF="tests.urls",
        SECRET_KEY="test-secret-key",
        TEMPLATES=[
            {
                "BACKEND": "django.template.backends.django.DjangoTemplates",
                "DIRS": [],
                "APP_DIRS": True,
                "OPTIONS": {
                    "context_processors": [
                        "django.template.context_processors.request",
                        "toggly_django.context_processors.toggly",
                    ],
                },
            },
        ],
        MIDDLEWARE=[
            "toggly_django.middleware.TogglyMiddleware",
        ],
        TOGGLY_APP_KEY="test-app-key",
        TOGGLY_ENVIRONMENT="Test",
        USE_TZ=True,
    )
    django.setup()
