"""Startup variants must belong to one complete, immutable context."""
import asyncio
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import pytest

from toggly import AsyncTogglyClient, TogglyClient, TogglyConfig
from toggly.http import HttpResponse, build_evaluated_variants_url
from toggly.providers import MemorySnapshotProvider, VariantsSnapshot


def config(**kwargs):
    return TogglyConfig(app_key="app", enable_variants=True,
                        disable_background_refresh=True, enable_live_updates=False,
                        enable_usage_tracking=False, enable_metrics=False,
                        register_contexts_on_startup=False, **kwargs)


def response():
    return HttpResponse(200, b'{"defs":{"flag":{"enabled":true,"variant":"a"}}}',
                        {"ETag": "revision"})


@pytest.mark.parametrize("asynchronous", [False, True])
def test_first_request_snapshots_complete_context(asynchronous):
    groups, claims = [" beta ", "team &a"], {"plan": "pro&plus"}
    cfg = config(identity="user&123", variant_groups=groups, variant_claims=claims)
    copy = cfg.with_environment("Production")
    groups.append("late")
    claims["plan"] = "late"
    cls = AsyncTogglyClient if asynchronous else TogglyClient
    if asynchronous:
        asyncio.set_event_loop(asyncio.new_event_loop())
    client = cls(copy)
    copy.variant_groups.append("later")
    copy.variant_claims["plan"] = "later"
    with patch("toggly.http.HttpClient.get", return_value=response()) as get:
        if asynchronous:
            async def run():
                await client.init()
                await client.close()
            asyncio.run(run())
        else:
            client.init()
            client.close()
    assert get.call_count == 1
    query = parse_qs(urlsplit(get.call_args.args[0]).query)
    assert query == {"userId": ["user&123"], "g": ["beta", "team &a"],
                     "claim.plan": ["pro&plus"]}


def test_query_normalizes_caps_and_encodes_claims():
    claims = {"": "ignored", **{f"c{i}": f"v{i}&" for i in range(25)}}
    query = parse_qs(urlsplit(build_evaluated_variants_url(
        "https://example.test", "app", "Production", "u&x",
        groups=[" ", " g&a "], claims=claims)).query)
    assert query["g"] == ["g&a"]
    assert query["userId"] == ["u&x"]
    assert len([k for k in query if k.startswith("claim.")]) == 20
    assert query["claim.c0"] == ["v0&"]


@pytest.mark.parametrize("asynchronous", [False, True])
def test_legacy_variant_cache_is_not_context_evidence(asynchronous):
    provider = MemorySnapshotProvider()
    provider.save_variants(VariantsSnapshot(etag="other-context"))
    if asynchronous:
        asyncio.set_event_loop(asyncio.new_event_loop())
    client = (AsyncTogglyClient if asynchronous else TogglyClient)(config(
        identity="user", variant_groups=["beta"], snapshot_provider=provider))
    with patch("toggly.http.HttpClient.get", return_value=response()) as get:
        if asynchronous:
            async def run():
                await client.init()
                await client.close()
            asyncio.run(run())
        else:
            client.init()
            client.close()
    assert not get.call_args.kwargs["headers"]
    assert provider.load_variants().context_key


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("changed", [None, "groups", "claims", "identity"])
def test_cache_requires_complete_matching_context(asynchronous, changed):
    provider = MemorySnapshotProvider()
    cfg = config(identity="user", variant_groups=["beta"], variant_claims={"plan": "pro"},
                 snapshot_provider=provider)
    async def run_async():
        first = AsyncTogglyClient(cfg)
        with patch("toggly.http.HttpClient.get", return_value=response()):
            await first.init()
        await first.close()
        mutate()
        second = AsyncTogglyClient(cfg)
        with patch("toggly.http.HttpClient.get", return_value=response()) as get:
            await second.init()
        await second.close()
        return get
    def mutate():
        if changed == "groups":
            cfg.variant_groups = ["other"]
        elif changed == "claims":
            cfg.variant_claims = {"plan": "free"}
        elif changed == "identity":
            cfg.identity = "other"
    if asynchronous:
        get = asyncio.run(run_async())
    else:
        first = TogglyClient(cfg)
        with patch("toggly.http.HttpClient.get", return_value=response()):
            first.init()
        first.close()
        mutate()
        second = TogglyClient(cfg)
        with patch("toggly.http.HttpClient.get", return_value=response()) as get:
            second.init()
        second.close()
    assert get.call_args.kwargs["headers"] == (
        {"If-None-Match": "revision"} if changed is None else {})
    saved = provider.load_variants()
    assert VariantsSnapshot.from_dict(saved.to_dict()).context_key == saved.context_key


@pytest.mark.parametrize("asynchronous", [False, True])
def test_inflight_old_identity_cannot_overwrite_new_context(asynchronous):
    import threading
    entered, release = threading.Event(), threading.Event()
    seen = []
    def fetch(url, headers):
        seen.append((parse_qs(urlsplit(url).query), headers))
        if len(seen) == 1:
            entered.set()
            assert release.wait(5)
            return response()
        return HttpResponse(200, b'{"defs":{"flag":{"enabled":false,"variant":"b"}}}',
                            {"ETag": "same-revision"})
    cfg = config(identity="old", variant_groups=["beta"])
    if asynchronous:
        async def run():
            client = AsyncTogglyClient(cfg)
            pending = asyncio.create_task(client.init())
            while not entered.is_set():
                await asyncio.sleep(0)
            await client.set_identity("new")
            assert await client.get_variant("flag") is None
            release.set()
            await pending
            assert (await client.get_variant("flag")).name == "b"
            await client.close()
        with patch("toggly.http.HttpClient.get", side_effect=fetch):
            asyncio.run(run())
    else:
        client = TogglyClient(cfg)
        with patch("toggly.http.HttpClient.get", side_effect=fetch):
            thread = threading.Thread(target=client.init)
            thread.start()
            assert entered.wait(5)
            client.set_identity("new")
            assert client.get_variant("flag") is None
            release.set()
            thread.join(5)
            assert not thread.is_alive()
        assert client.get_variant("flag").name == "b"
        client.close()
    assert [query["userId"] for query, headers in seen] == [["old"], ["new"]]
    assert all(not headers for query, headers in seen)


def test_empty_context_and_delimiter_collision_are_distinct():
    assert build_evaluated_variants_url("https://test", "app", "env", groups=[], claims={}) == (
        "https://test/evaluated-variants-signed/app/env")
    one = TogglyClient(config(variant_groups=["a&g=b"]))
    two = TogglyClient(config(variant_groups=["a", "b"]))
    assert one._variant_context_key() != two._variant_context_key()
    one.close()
    two.close()


@pytest.mark.parametrize("asynchronous", [False, True])
def test_cache_handoff_rechecks_context(asynchronous):
    from toggly.enums import LoadStatus
    cfg = config(identity="original")
    async def run():
        client = AsyncTogglyClient(cfg)
        stale = VariantsSnapshot(etag="stale", context_key=client._variant_context_key())
        with patch.object(client, "refresh") as refresh:
            refresh.return_value.status = LoadStatus.CACHED
            await client.set_identity("new")
        await client._apply_variants_snapshot(stale)
        assert client._etag is None
        await client.close()
    if asynchronous:
        asyncio.run(run())
    else:
        client = TogglyClient(cfg)
        stale = VariantsSnapshot(etag="stale", context_key=client._variant_context_key())
        with patch.object(client, "refresh"):
            client.set_identity("new")
        client._apply_variants_snapshot(stale)
        assert client._etag is None
        client.close()


def test_claims_keep_exact_whitespace_and_deterministic_cap():
    claims = {f"c{i:02}": str(i) for i in reversed(range(25))}
    claims.update({"": "no", "empty": "", "wrong": 1})
    query = parse_qs(urlsplit(build_evaluated_variants_url(
        "https://test", "app", "env", claims=claims)).query)
    assert set(query) == {f"claim.c{i:02}" for i in range(20)}
    query = parse_qs(urlsplit(build_evaluated_variants_url(
        "https://test", "app", "env", claims={" name ": " value "})).query)
    assert query == {"claim. name ": [" value "]}


@pytest.mark.parametrize("asynchronous", [False, True])
def test_matching_context_accepts_304(asynchronous):
    provider = MemorySnapshotProvider()
    cfg = config(identity="user", variant_groups=["beta"], snapshot_provider=provider)
    async def run():
        client = AsyncTogglyClient(cfg)
        with patch("toggly.http.HttpClient.get", return_value=response()):
            await client.init()
        await client.close()
        client = AsyncTogglyClient(cfg)
        with patch("toggly.http.HttpClient.get", return_value=HttpResponse(304, b"", {})) as get:
            await client.init()
        assert (await client.get_variant("flag")).name == "a"
        assert get.call_args.kwargs["headers"] == {"If-None-Match": "revision"}
        await client.close()
    if asynchronous:
        asyncio.run(run())
    else:
        client = TogglyClient(cfg)
        with patch("toggly.http.HttpClient.get", return_value=response()):
            client.init()
        client.close()
        client = TogglyClient(cfg)
        with patch("toggly.http.HttpClient.get", return_value=HttpResponse(304, b"", {})) as get:
            client.init()
        assert client.get_variant("flag").name == "a"
        assert get.call_args.kwargs["headers"] == {"If-None-Match": "revision"}
        client.close()


def test_identity_changed_by_state_handler_does_not_cache_old_response():
    client = TogglyClient(config(identity="old"))
    def changed(key, old, new):
        if key == "flag" and client.current_identity == "old":
            client.set_identity("new")
    client._config.state_change_handlers.append(changed)
    with patch("toggly.http.HttpClient.get", side_effect=[response(), response()]) as get:
        client.init()
    assert get.call_count == 2
    assert client._snapshot_provider.load_variants().context_key == client._variant_context_key()
    client.close()
