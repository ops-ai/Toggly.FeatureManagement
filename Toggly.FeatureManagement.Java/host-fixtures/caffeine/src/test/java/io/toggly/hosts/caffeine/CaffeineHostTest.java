package io.toggly.hosts.caffeine;

import io.toggly.cache.caffeine.CaffeineCacheConfig;
import io.toggly.cache.caffeine.CaffeineCachingSnapshotProvider;
import io.toggly.cache.caffeine.CaffeineEvaluationCache;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.SnapshotProvider;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

class CaffeineHostTest {

    @Test
    void packagedCaffeineAdapterCachesAndInvalidatesSnapshots() {
        AtomicInteger refreshes = new AtomicInteger();
        SnapshotProvider delegate = new SnapshotProvider() {
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

        CaffeineCachingSnapshotProvider cache = new CaffeineCachingSnapshotProvider(
                delegate,
                CaffeineCacheConfig.builder()
                        .expireAfterWrite(Duration.ofMinutes(1))
                        .maximumSize(10)
                        .recordStats()
                        .build());

        FeatureSnapshot first = cache.getSnapshot();
        assertSame(first, cache.getSnapshot());
        assertEquals(1, refreshes.get());

        cache.refresh();
        assertEquals(2, refreshes.get());
        cache.close();
    }

    @Test
    void packagedCaffeineAdapterSeparatesCollidingTargetingContexts() {
        CaffeineEvaluationCache cache = CaffeineEvaluationCache.builder().build();
        EvaluationContext first = EvaluationContext.builder()
                .identity("host-user")
                .trait("segment", "Aa")
                .build();
        EvaluationContext second = EvaluationContext.builder()
                .identity("host-user")
                .trait("segment", "BB")
                .build();

        assertEquals("Aa".hashCode(), "BB".hashCode());
        assertEquals(true, cache.getOrCompute("targeted", first, () -> true));
        assertEquals(false, cache.getOrCompute("targeted", second, () -> false));
    }
}
