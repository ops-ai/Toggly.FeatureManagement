import asyncio

import pytest

from toggly.telemetry import UsageBatcher
from toggly.telemetry.usage_scope import run_usage_scope, run_usage_scope_async


def _handlers(batcher: UsageBatcher, feature: str):
    return (
        lambda: batcher.record_usage(feature),
        lambda ms: batcher.record_usage_duration(feature, ms),
        lambda ms: (
            batcher.record_usage_error(feature),
            batcher.record_usage_duration(feature, ms, failed=True),
        ),
    )


class TestUsageScope:
    def test_success_records_duration_not_error(self):
        batcher = UsageBatcher("app", "Production")
        run_usage_scope(_handlers(batcher, "Feat"), lambda _scope: None)
        vs = batcher.build_and_reset()["stats"][0]["variantStats"]["enabled"]
        assert vs["usedCount"] == 1
        assert vs.get("errorCount", 0) == 0
        assert vs.get("durationSumMs", 0) >= 0

    def test_failure_records_error(self):
        batcher = UsageBatcher("app", "Production")
        with pytest.raises(ValueError):
            run_usage_scope(
                _handlers(batcher, "FailFeat"),
                lambda _scope: (_ for _ in ()).throw(ValueError("boom")),
            )
        vs = batcher.build_and_reset()["stats"][0]["variantStats"]["enabled"]
        assert vs["usedCount"] == 1
        assert vs["errorCount"] == 1

    def test_explicit_fail(self):
        batcher = UsageBatcher("app", "Production")
        run_usage_scope(_handlers(batcher, "Soft"), lambda scope: scope.fail())
        vs = batcher.build_and_reset()["stats"][0]["variantStats"]["enabled"]
        assert vs["errorCount"] == 1

    @pytest.mark.asyncio
    async def test_cancelled_records_attempt_only(self):
        batcher = UsageBatcher("app", "Production")

        async def fn(_scope):
            raise asyncio.CancelledError

        with pytest.raises(asyncio.CancelledError):
            await run_usage_scope_async(_handlers(batcher, "Cancel"), fn)

        vs = batcher.build_and_reset()["stats"][0]["variantStats"]["enabled"]
        assert vs["usedCount"] == 1
        assert vs.get("errorCount", 0) == 0
        assert vs.get("durationSumMs", 0) == 0
