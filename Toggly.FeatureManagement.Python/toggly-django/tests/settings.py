"""Django settings for testing toggly-django."""

SECRET_KEY = "test-secret-key-for-testing-only"  # noqa: S105

DEBUG = True

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "toggly_django",
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

ROOT_URLCONF = "tests.urls"

TEMPLATES = [
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
]

MIDDLEWARE = [
    "toggly_django.middleware.TogglyMiddleware",
]

# Toggly settings
TOGGLY_APP_KEY = "test-app-key"
TOGGLY_ENVIRONMENT = "Test"

USE_TZ = True
