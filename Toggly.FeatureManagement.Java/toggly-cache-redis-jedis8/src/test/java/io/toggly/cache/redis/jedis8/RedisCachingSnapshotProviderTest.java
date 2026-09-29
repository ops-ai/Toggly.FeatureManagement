package io.toggly.cache.redis.jedis8;

import io.toggly.cache.redis.RedisCacheConfig;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.SnapshotProvider;
import org.junit.jupiter.api.Test;
import org.mockito.MockedConstruction;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockConstruction;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RedisCachingSnapshotProviderTest {

    @Test
    void suppliedJedis8PoolRoundTripsSnapshotWithoutAnotherRefresh() {
        JedisPool pool = mock(JedisPool.class);
        Jedis jedis = mock(Jedis.class);
        when(pool.getResource()).thenReturn(jedis);
        AtomicReference<String> stored = new AtomicReference<>();
        doAnswer(invocation -> {
            stored.set(invocation.getArgument(2));
            return "OK";
        }).when(jedis).setex(org.mockito.ArgumentMatchers.eq("app:snapshot"),
                org.mockito.ArgumentMatchers.eq(90L), anyString());
        when(jedis.get("app:snapshot")).thenAnswer(invocation -> stored.get());

        CountingProvider delegate = new CountingProvider(snapshot());
        RedisCachingSnapshotProvider provider = new RedisCachingSnapshotProvider(
                delegate, pool, "app:", Duration.ofSeconds(90));
        try {
            assertSame(delegate.snapshot, provider.refresh());
            assertNotNull(stored.get());

            FeatureSnapshot cached = provider.getSnapshot();
            assertNotNull(cached.getFeature("rollout"));
            assertEquals("revision-1", cached.getEtag());
            assertEquals(1, delegate.refreshes.get());

            provider.clear();
            verify(jedis).del("app:snapshot");
            assertEquals(1, delegate.clears.get());
        } finally {
            provider.close();
        }
    }

    @Test
    void defaultConfigurationWritesToTheStableRedisKeyWithFiveMinuteTtl() {
        Jedis jedis = mock(Jedis.class);
        try (MockedConstruction<JedisPool> pools = mockConstruction(JedisPool.class,
                (pool, context) -> when(pool.getResource()).thenReturn(jedis))) {
            RedisCachingSnapshotProvider provider =
                    new RedisCachingSnapshotProvider(new CountingProvider(snapshot()));
            try {
                provider.refresh();
                verify(jedis).setex(org.mockito.ArgumentMatchers.eq("toggly:snapshot"),
                        org.mockito.ArgumentMatchers.eq(300L), anyString());
            } finally {
                provider.close();
            }
            assertEquals(1, pools.constructed().size());
        }
    }

    @Test
    void customConfigurationWithoutTtlWritesTheSelectedKeyWithoutExpiry() {
        Jedis jedis = mock(Jedis.class);
        RedisCacheConfig config = RedisCacheConfig.builder()
                .keyPrefix("tenant-a:")
                .ttl(Duration.ZERO)
                .build();
        try (MockedConstruction<JedisPool> pools = mockConstruction(JedisPool.class,
                (pool, context) -> when(pool.getResource()).thenReturn(jedis))) {
            RedisCachingSnapshotProvider provider =
                    new RedisCachingSnapshotProvider(new CountingProvider(snapshot()), config);
            try {
                provider.refresh();
                verify(jedis).set(org.mockito.ArgumentMatchers.eq("tenant-a:snapshot"), anyString());
            } finally {
                provider.close();
            }
            assertEquals(1, pools.constructed().size());
        }
    }

    private static FeatureSnapshot snapshot() {
        FeatureDefinition rollout = FeatureDefinition.builder().featureKey("rollout").build();
        return new FeatureSnapshot(Map.of("rollout", rollout), Map.of(),
                Instant.parse("2026-09-29T00:00:00Z"), "revision-1");
    }

    private static final class CountingProvider implements SnapshotProvider {
        private final FeatureSnapshot snapshot;
        private final AtomicInteger refreshes = new AtomicInteger();
        private final AtomicInteger clears = new AtomicInteger();

        private CountingProvider(FeatureSnapshot snapshot) {
            this.snapshot = snapshot;
        }

        @Override
        public FeatureSnapshot getSnapshot() {
            return snapshot;
        }

        @Override
        public FeatureSnapshot refresh() {
            refreshes.incrementAndGet();
            return snapshot;
        }

        @Override
        public void clear() {
            clears.incrementAndGet();
        }
    }
}
