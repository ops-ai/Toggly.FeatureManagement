"""Application startup forwards context before initialization."""
from unittest.mock import patch


def test_startup_context():
    from toggly_fastapi.middleware import configure_toggly
    with patch("toggly_fastapi.middleware.TogglyClient") as factory:
        def initialize():
            cfg = factory.call_args.args[0]
            assert cfg.identity == "user&123"
        factory.return_value.init.side_effect = initialize
        configure_toggly(identity="user&123")
        factory.return_value.init.assert_called_once()
