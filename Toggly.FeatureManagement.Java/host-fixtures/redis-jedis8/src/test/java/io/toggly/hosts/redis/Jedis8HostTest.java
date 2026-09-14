package io.toggly.hosts.redis;

import io.toggly.cache.redis.RedisCacheConfig;
import io.toggly.cache.redis.jedis8.RedisCachingSnapshotProvider;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.SnapshotProvider;
import org.junit.jupiter.api.Test;
import redis.clients.jedis.Jedis;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class Jedis8HostTest {

    @Test
    void currentAdapterStoresReadsAndClearsTheExistingSnapshotKey() {
        String host = System.getProperty("redis.host");
        int port = Integer.parseInt(System.getProperty("redis.port"));
        String prefix = "toggly:host:jedis8:";
        AtomicInteger refreshes = new AtomicInteger();
        SnapshotProvider delegate = snapshotProvider(refreshes);
        RedisCachingSnapshotProvider provider = new RedisCachingSnapshotProvider(
                delegate,
                RedisCacheConfig.builder().host(host).port(port).keyPrefix(prefix)
                        .ttl(Duration.ofMinutes(1)).build());

        try (Jedis redis = new Jedis(host, port)) {
            redis.del(prefix + "snapshot");
        }

        provider.refresh();
        try (Jedis redis = new Jedis(host, port)) {
            assertNotNull(redis.get(prefix + "snapshot"));
        }
        provider.getSnapshot();
        assertEquals(1, refreshes.get());

        provider.clear();
        try (Jedis redis = new Jedis(host, port)) {
            assertNull(redis.get(prefix + "snapshot"));
        }
        provider.close();
    }

    private static SnapshotProvider snapshotProvider(AtomicInteger refreshes) {
        return new SnapshotProvider() {
            @Override
            public FeatureSnapshot getSnapshot() {
                return refresh();
            }

            @Override
            public FeatureSnapshot refresh() {
                refreshes.incrementAndGet();
                return FeatureSnapshot.empty();
            }
        };
    }
}
