# Toggly Python SDK

Official Python SDK for [Toggly](https://toggly.io) feature flag management. This monorepo contains multiple packages for different Python frameworks and use cases.

<p align="center">
  <a href="https://pypi.org/project/toggly/"><img src="https://img.shields.io/pypi/v/toggly.svg" alt="PyPI"></a>
  <a href="https://pypi.org/project/toggly/"><img src="https://img.shields.io/pypi/pyversions/toggly.svg" alt="Python versions"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`toggly`](./toggly) | Core SDK with zero dependencies | `pip install toggly` |
| [`toggly-django`](./toggly-django) | Django integration | `pip install toggly-django` |
| [`toggly-flask`](./toggly-flask) | Flask integration | `pip install toggly-flask` |
| [`toggly-fastapi`](./toggly-fastapi) | FastAPI/Starlette integration | `pip install toggly-fastapi` |
| [`toggly-cache`](./toggly-cache) | Redis/Memcached caching | `pip install toggly-cache[redis]` |

## Quick Start

### Core SDK

```python
from toggly import TogglyClient, TogglyConfig

# Configure the client
config = TogglyConfig(
    app_key="your-app-key",
    environment="Production",
)

# Create and initialize the client
client = TogglyClient(config)
client.init()

# Check if a feature is enabled
if client.is_enabled("new-feature"):
    print("Feature is enabled!")

# Use with evaluation context for targeting
from toggly import EvaluationContext

context = EvaluationContext(
    identity="user-123",
    groups=["beta-testers"],
    traits={"plan": "premium"}
)

if client.is_enabled("premium-feature", context):
    print("Premium feature enabled for this user!")
```

### Django

```python
# settings.py
INSTALLED_APPS = [
    ...
    'toggly_django',
]

TOGGLY_APP_KEY = 'your-app-key'
TOGGLY_ENVIRONMENT = 'Production'

# views.py
from toggly_django.decorators import feature_flag_required

@feature_flag_required('new-dashboard')
def new_dashboard(request):
    return render(request, 'new_dashboard.html')

# templates
{% load toggly_tags %}
{% iffeature 'new-feature' %}
    <div>New feature content!</div>
{% endiffeature %}
```

### Flask

```python
from flask import Flask
from toggly_flask import Toggly

app = Flask(__name__)
app.config['TOGGLY_APP_KEY'] = 'your-app-key'
app.config['TOGGLY_ENVIRONMENT'] = 'Production'

toggly = Toggly(app)

@app.route('/')
def index():
    if toggly.is_enabled('new-feature'):
        return 'New feature!'
    return 'Original'
```

### FastAPI

```python
from fastapi import FastAPI, Depends
from toggly_fastapi import configure_toggly, TogglyMiddleware, require_feature

app = FastAPI()

@app.on_event("startup")
def startup():
    configure_toggly(app_key="your-app-key")

app.add_middleware(TogglyMiddleware)

@app.get("/new-feature", dependencies=[Depends(require_feature("new-feature"))])
async def new_feature():
    return {"message": "New feature!"}
```

## Features

- **Zero dependencies core** - The core package has no external dependencies
- **Framework integrations** - Native integrations for Django, Flask, and FastAPI
- **Type hints** - Full type annotations for IDE support and type checking
- **Sync and async** - Both synchronous and asynchronous clients
- **Decorators** - Function and view decorators for feature gating
- **Context managers** - Python context managers for scoped evaluation
- **Caching** - Optional Redis and Memcached caching providers
- **Background refresh** - Automatic background refresh of feature definitions
- **Offline support** - Snapshot providers for offline/startup resilience

## Requirements

- Python 3.8+
- Django 4.2+ (for toggly-django)
- Flask 2.0+ (for toggly-flask)
- FastAPI 0.100+ (for toggly-fastapi)

## Documentation

Full documentation is available at [docs.toggly.io/sdks/python](https://docs.toggly.io/sdks/python).

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/ops-ai/toggly-sdks.git
cd toggly-sdks/python

# Create virtual environment
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows

# Install all packages in development mode
pip install -e toggly/[dev]
pip install -e toggly-django/[dev]
pip install -e toggly-flask/[dev]
pip install -e toggly-fastapi/[dev]
pip install -e toggly-cache/[all,dev]
```

### Running Tests

```bash
# Run all tests
pytest

# Run tests for specific package
cd toggly && pytest
cd toggly-django && pytest
cd toggly-flask && pytest
cd toggly-fastapi && pytest
cd toggly-cache && pytest

# Run with coverage
pytest --cov=src --cov-report=html
```

### Linting and Type Checking

```bash
# Lint with ruff
ruff check .

# Type check with mypy
mypy toggly/src
mypy toggly-cache/src
```

## Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Toggly](https://toggly.io)
- [Documentation](https://docs.toggly.io/sdks/python)
- [GitHub Repository](https://github.com/ops-ai/toggly-sdks)
- [Issue Tracker](https://github.com/ops-ai/toggly-sdks/issues)
