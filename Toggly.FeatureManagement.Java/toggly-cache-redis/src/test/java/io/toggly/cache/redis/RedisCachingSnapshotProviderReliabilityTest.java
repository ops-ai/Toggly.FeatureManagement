package io.toggly.cache.redis;

import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureRequirement;
import io.toggly.core.model.MetricDefinition;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.SnapshotProvider;
import io.toggly.core.telemetry.DefinitionCacheRecorder;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RedisCachingSnapshotProviderReliabilityTest {

    @Mock
    private SnapshotProvider delegate;

    @Mock
    private JedisPool pool;

    @Mock
    private Jedis jedis;

    @Mock
    private DefinitionCacheRecorder recorder;

    @Test
    void malformedFeatureObjectsFallBackToTheDelegate() {
        FeatureSnapshot fresh = snapshot("fresh");
        RedisCachingSnapshotProvider provider = provider(Duration.ofMinutes(1));
        when(pool.getResource()).thenReturn(jedis);
        when(delegate.refresh()).thenReturn(fresh);

        for (String malformed : new String[] {
                "{\"features\":{\"cached\":{\"featureKey\":\"cached\"},\"timestamp\":\"2026-09-29T00:00:00Z\"}",
                "{\"features\":null,\"metrics\":{\"wrong\":{\"featureKey\":\"wrong\"}},\"timestamp\":\"2026-09-29T00:00:00Z\"}",
                "{\"features\":{\"bad\":null},\"metrics\":{},\"timestamp\":\"2026-09-29T00:00:00Z\"}",
                "[]",
                "{\"metrics\":{}}",
                "{\"features\" {}}",
                "{\"features\":[]}",
                "{\"features\":{\"good\":{}, #}}",
                "{\"features\":{\"good\" {}}}",
                "{\"features\":{\"good\":[]}}",
                "{\"features\":{}} trailing"
        }) {
            when(jedis.get("unit:snapshot")).thenReturn(malformed);

            assertThat(provider.getSnapshot()).isSameAs(fresh);
        }

        verify(delegate, times(11)).refresh();
        verify(jedis, times(11)).setex(anyString(), anyLong(), anyString());
    }

    @Test
    void cachedFeaturesWithWhitespaceAndEscapedKeysRemainReadable() {
        RedisCachingSnapshotProvider provider = provider(Duration.ofMinutes(1));
        when(pool.getResource()).thenReturn(jedis);
        when(jedis.get("unit:snapshot")).thenReturn("""
                 {"features" \t :
                 { "quote\\\"key" \t :
                 {}, "second":{} },
                 "metrics":{},"timestamp":"2026-09-29T00:00:00Z"} \t
                """);

        FeatureSnapshot cached = provider.getSnapshot();

        assertThat(cached.getFeatures().keySet()).containsExactlyInAnyOrder("quote\"key", "second");
        assertThat(cached.getTimestamp()).isEqualTo(Instant.parse("2026-09-29T00:00:00Z"));
    }

    @Test
    void cacheMissAndReadFailureRefreshTheDelegateAndPersistTheResult() throws Exception {
        FeatureSnapshot fresh = snapshot("fresh");
        RedisCachingSnapshotProvider provider = provider(Duration.ZERO);
        when(pool.getResource()).thenReturn(jedis);
        when(jedis.get("unit:snapshot")).thenReturn("");
        when(delegate.refresh()).thenReturn(fresh);

        assertThat(provider.getSnapshotAsync().get(5, TimeUnit.SECONDS)).isSameAs(fresh);
        verify(jedis).set(eq("unit:snapshot"), anyString());

        doThrow(new IllegalStateException("Redis unavailable")).when(jedis).get("unit:snapshot");
        assertThat(provider.getSnapshot()).isSameAs(fresh);
        verify(delegate, times(2)).refresh();
    }

    @Test
    void clearCloseAndInstrumentationForwardToTheirOwners() {
        RedisCachingSnapshotProvider provider = provider(Duration.ofSeconds(5));
        when(pool.getResource()).thenReturn(jedis);
        when(pool.isClosed()).thenReturn(false);

        provider.setDefinitionCacheRecorder(recorder);
        java.util.function.Consumer<FeatureSnapshot> listener = snapshot -> { };
        provider.addRefreshListener(listener);
        provider.removeRefreshListener(listener);
        provider.clearJwks();
        provider.clear();
        provider.close();

        verify(delegate).setDefinitionCacheRecorder(recorder);
        // Wrapper owns public listeners; only the internal write-before-notify bridge is
        // registered on the delegate (added in the constructor, removed on close).
        verify(delegate).addRefreshListener(org.mockito.ArgumentMatchers.any());
        verify(delegate).removeRefreshListener(org.mockito.ArgumentMatchers.any());
        verify(delegate).clearJwks();
        verify(jedis).del("unit:snapshot");
        verify(delegate).clear();
        verify(pool).close();
        verify(delegate).close();
    }

    @Test
    void refreshPreservesMetricsAndSignedDefinitionMetadata() {
        FeatureSnapshot signed = new FeatureSnapshot(
                Map.of("checkout", FeatureDefinition.builder()
                        .featureKey("checkout")
                        .requirementType(FeatureRequirement.ALL)
                        .contextKind("account")
                        .contextRequirementType(FeatureRequirement.ANY)
                        .build()),
                Map.of("checkout-count", MetricDefinition.of("checkout-count", "counter", "count")),
                Instant.parse("2026-09-29T00:00:00Z"),
                "etag-1",
                "signature-1",
                "key-1",
                1_727_000_000L,
                "[{\"featureKey\":\"checkout\"}]");
        RedisCachingSnapshotProvider provider = provider(Duration.ofSeconds(2));
        when(pool.getResource()).thenReturn(jedis);
        when(delegate.refresh()).thenReturn(signed);

        assertThat(provider.refresh()).isSameAs(signed);

        ArgumentCaptor<String> serialized = ArgumentCaptor.forClass(String.class);
        verify(jedis).setex(eq("unit:snapshot"), eq(2L), serialized.capture());
        assertThat(serialized.getValue())
                .contains("\"metrics\":{\"checkout-count\"")
                .contains("\"type\":\"counter\"")
                .contains("\"unit\":\"count\"")
                .contains("\"signature\":\"signature-1\"")
                .contains("\"keyId\":\"key-1\"")
                .contains("\"signedTimestamp\":1727000000")
                .contains("\"signedDefsJson\":\"[{\\\"featureKey\\\":\\\"checkout\\\"}]\"");
    }

    @Test
    void redisRoundTripRestoresMetrics() {
        FeatureSnapshot signed = new FeatureSnapshot(
                Map.of("checkout", FeatureDefinition.builder().featureKey("checkout").build()),
                Map.of("checkout-count", MetricDefinition.of("Checkout count", "counter", "count")),
                Instant.parse("2026-09-29T00:00:00Z"),
                "etag-1");
        RedisCachingSnapshotProvider provider = provider(Duration.ofSeconds(2));
        AtomicReference<String> store = new AtomicReference<>();
        when(pool.getResource()).thenReturn(jedis);
        when(jedis.get(anyString())).thenAnswer(invocation -> store.get());
        doAnswer(invocation -> {
            store.set(invocation.getArgument(2));
            return null;
        }).when(jedis).setex(anyString(), anyLong(), anyString());
        when(delegate.refresh()).thenReturn(signed);

        provider.refresh();
        FeatureSnapshot loaded = provider.getSnapshot();

        assertThat(loaded.getMetrics()).isEqualTo(
                Map.of("checkout-count", MetricDefinition.of("Checkout count", "counter", "count")));
    }

    @Test
    void featureNamedMetricsDoesNotHideTopLevelMetrics() {
        RedisCachingSnapshotProvider provider = provider(Duration.ofSeconds(5));
        when(pool.getResource()).thenReturn(jedis);
        when(jedis.get("unit:snapshot")).thenReturn(
                "{\"features\":{\"metrics\":{\"featureKey\":\"metrics\",\"requirementType\":\"Any\","
                        + "\"filters\":[],\"contextKind\":\"metrics\"}},"
                        + "\"metrics\":{\"checkout-count\":{\"metricKey\":\"checkout-count\","
                        + "\"name\":\"Checkout count\",\"type\":\"counter\",\"unit\":\"count\"}},"
                        + "\"timestamp\":\"2026-09-29T00:00:00Z\"}");

        FeatureSnapshot loaded = provider.getSnapshot();

        assertThat(loaded.getFeature("metrics")).isNotNull();
        assertThat(loaded.getFeature("metrics").getContextKind()).isEqualTo("metrics");
        assertThat(loaded.getMetrics()).isEqualTo(
                Map.of("checkout-count", MetricDefinition.of("Checkout count", "counter", "count")));
    }

    @Test
    void rootScalarsBeforeMetricsStillLoad() {
        RedisCachingSnapshotProvider provider = provider(Duration.ofSeconds(5));
        when(pool.getResource()).thenReturn(jedis);
        when(jedis.get("unit:snapshot")).thenReturn(
                "{\"features\":{},\"note\":\"metrics\",\"tags\":[\"metrics\"],\"signedTimestamp\":5,"
                        + "\"metrics\":{"
                        + "\"only-key\":{\"metricKey\":\"only-key\",\"type\":\"counter\",\"unit\":\"count\"},"
                        + "\"bare\":{}"
                        + "},\"timestamp\":\"2026-09-29T00:00:00Z\"}");

        FeatureSnapshot loaded = provider.getSnapshot();

        assertThat(loaded.getMetrics()).isEqualTo(Map.of(
                "only-key", MetricDefinition.of("only-key", "counter", "count"),
                "bare", MetricDefinition.of("bare", null, null)));
    }

    @Test
    void nonObjectMetricsValueLeavesMetricsEmpty() {
        RedisCachingSnapshotProvider provider = provider(Duration.ofSeconds(5));
        when(pool.getResource()).thenReturn(jedis);
        when(jedis.get("unit:snapshot")).thenReturn(
                "{\"features\":{},\"metrics\":\"nope\",\"timestamp\":\"2026-09-29T00:00:00Z\"}");

        FeatureSnapshot loaded = provider.getSnapshot();

        assertThat(loaded.getMetrics()).isEmpty();
        assertThat(loaded.getFeatures()).isEmpty();
    }

    @Test
    void nonHttpCacheHitsAreRecordedOnceUntilTheCacheIsCleared() {
        RedisCachingSnapshotProvider provider = provider(Duration.ofSeconds(3));
        when(pool.getResource()).thenReturn(jedis);
        when(jedis.get("unit:snapshot")).thenReturn(
                "{\"features\":{},\"metrics\":{},\"timestamp\":\"2026-09-29T00:00:00Z\"}");

        provider.setDefinitionCacheRecorder(recorder);
        provider.getSnapshot();
        provider.getSnapshot();
        provider.clear();
        provider.getSnapshot();

        verify(recorder, times(2)).recordDefinitionCacheHit();
    }

    @Test
    void directConstructorsCreateAndCloseJedis5PoolsForEachConnectionMode() {
        for (RedisCacheConfig config : new RedisCacheConfig[] {
                RedisCacheConfig.defaults(),
                RedisCacheConfig.builder().password("redis-passphrase").build(),
                RedisCacheConfig.builder().ssl().build()
        }) {
            RedisCachingSnapshotProvider provider = new RedisCachingSnapshotProvider(delegate, config);
            assertThatCode(() -> {
                provider.close();
                provider.close();
            }).doesNotThrowAnyException();
        }
    }

    @Test
    void buildersExposeConfiguredConnectionAndCacheValues() {
        RedisCacheConfig defaults = RedisCacheConfig.defaults();
        RedisCacheConfig configured = RedisCacheConfig.builder()
                .host("redis.internal")
                .port(6380)
                .password("redis-passphrase")
                .database(2)
                .keyPrefix("app:")
                .ttl(Duration.ofSeconds(12))
                .timeout(345)
                .ssl()
                .build();

        assertThat(defaults.getHost()).isEqualTo("localhost");
        assertThat(defaults.getPort()).isEqualTo(6379);
        assertThat(defaults.getPassword()).isNull();
        assertThat(defaults.getDatabase()).isZero();
        assertThat(defaults.getKeyPrefix()).isEqualTo("toggly:");
        assertThat(defaults.getTtl()).isEqualTo(Duration.ofMinutes(5));
        assertThat(defaults.getTimeout()).isEqualTo(2000);
        assertThat(defaults.isSsl()).isFalse();
        assertThat(configured.getHost()).isEqualTo("redis.internal");
        assertThat(configured.getPort()).isEqualTo(6380);
        assertThat(configured.getPassword()).isEqualTo("redis-passphrase");
        assertThat(configured.getDatabase()).isEqualTo(2);
        assertThat(configured.getKeyPrefix()).isEqualTo("app:");
        assertThat(configured.getTtl()).isEqualTo(Duration.ofSeconds(12));
        assertThat(configured.getTimeout()).isEqualTo(345);
        assertThat(configured.isSsl()).isTrue();
    }

    private RedisCachingSnapshotProvider provider(Duration ttl) {
        return new RedisCachingSnapshotProvider(delegate, pool, "unit:", ttl);
    }

    private static FeatureSnapshot snapshot(String key) {
        return new FeatureSnapshot(
                Map.of(key, FeatureDefinition.builder().featureKey(key).build()),
                Map.of(),
                Instant.parse("2026-09-29T00:00:00Z"),
                "etag-" + key);
    }
}
