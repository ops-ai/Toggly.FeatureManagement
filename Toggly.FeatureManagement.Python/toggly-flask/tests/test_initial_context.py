"""Application startup forwards context before initialization."""
from unittest.mock import patch

from flask import Flask

from toggly_flask.extension import Toggly


def test_startup_context():
    app = Flask(__name__)
    app.config.update(TOGGLY_IDENTITY="user&123", TOGGLY_VARIANT_GROUPS=["beta"],
                      TOGGLY_VARIANT_CLAIMS={"plan": "pro"}, TOGGLY_ENABLE_VARIANTS=True)
    with patch("toggly_flask.extension.TogglyClient") as factory:
        def initialize():
            cfg = factory.call_args.args[0]
            assert cfg.identity == "user&123"
            assert cfg.variant_groups == ["beta"]
            assert cfg.variant_claims == {"plan": "pro"}
        factory.return_value.init.side_effect = initialize
        Toggly(app)
        factory.return_value.init.assert_called_once()
