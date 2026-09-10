"""Application startup forwards context before initialization."""
from unittest.mock import patch

import pytest
from django.apps import apps
from django.test import override_settings


@pytest.mark.parametrize("entry", ["apps", "utils"])
def test_startup_context(entry):
    with patch(f"toggly_django.{entry}.TogglyClient") as factory:
        def initialize():
            cfg = factory.call_args.args[0]
            assert cfg.identity == "user&123"
            assert cfg.variant_groups == ["beta"]
            assert cfg.variant_claims == {"plan": "pro"}
        factory.return_value.init.side_effect = initialize
        if entry == "apps":
            with override_settings(TOGGLY={"IDENTITY": "user&123", "VARIANT_GROUPS": ["beta"],
                                           "VARIANT_CLAIMS": {"plan": "pro"}}):
                apps.get_app_config("toggly_django").ready()
        else:
            from toggly_django.utils import configure_toggly
            configure_toggly(identity="user&123", variant_groups=["beta"],
                             variant_claims={"plan": "pro"})
        factory.return_value.init.assert_called_once()
