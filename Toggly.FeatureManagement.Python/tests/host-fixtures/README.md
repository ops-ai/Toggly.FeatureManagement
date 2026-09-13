# Packed Python SDK compatibility hosts

`verify_packed_host.py` builds an isolated virtual environment, installs only
the wheels supplied by its caller, and verifies that imports resolve from
`site-packages` rather than the source tree.

The retained rows exercise core and Django with their matching Python runtime.
The current Python 3.14 / Django 6.1 row also runs Flask 3.1, FastAPI 0.141.1,
Redis-py 8.1, and the optional WebSocket and gRPC imports. Redis uses the
workflow service through `TOGGLY_REDIS_URL`; it never needs an application key.

Build wheels first, then run a selected host, for example:

```bash
python -m pip wheel --no-deps --wheel-dir .packed-wheels \
  toggly toggly-django toggly-flask toggly-fastapi toggly-cache
TOGGLY_REDIS_URL=redis://127.0.0.1:6379/15 \
  python tests/host-fixtures/verify_packed_host.py \
  --wheel-dir .packed-wheels --django-version '6.1.1' --frameworks all
```
