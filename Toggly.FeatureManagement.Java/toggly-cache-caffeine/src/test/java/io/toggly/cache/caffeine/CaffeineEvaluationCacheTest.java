package io.toggly.cache.caffeine;

import io.toggly.core.context.EvaluationContext;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class CaffeineEvaluationCacheTest {

    @Test
    void cachesResultsByFeatureAndContextUntilInvalidated() {
        CaffeineEvaluationCache cache = CaffeineEvaluationCache.builder()
                .expireAfterWrite(Duration.ofMinutes(1))
                .maximumSize(10)
                .recordStats()
                .build();
        EvaluationContext alice = EvaluationContext.forIdentity("alice");
        EvaluationContext bob = EvaluationContext.forIdentity("bob");
        AtomicInteger computations = new AtomicInteger();

        assertThat(cache.getOrCompute("a", alice, () -> counted(computations, true))).isTrue();
        assertThat(cache.getOrCompute("a", alice, () -> counted(computations, false))).isTrue();
        assertThat(cache.getOrCompute("a", bob, () -> counted(computations, false))).isFalse();
        assertThat(cache.getOrCompute("b", alice, () -> counted(computations, false))).isFalse();
        assertThat(cache.size()).isEqualTo(3);
        assertThat(cache.stats().hitCount()).isEqualTo(1);

        cache.invalidateFeature("a");
        assertThat(cache.getOrCompute("a", alice, () -> counted(computations, false))).isFalse();
        assertThat(cache.getOrCompute("b", alice, () -> counted(computations, true))).isFalse();
        assertThat(computations).hasValue(4);

        cache.invalidateAll();
        assertThat(cache.getOrCompute("b", alice, () -> counted(computations, true))).isTrue();
        assertThat(computations).hasValue(5);
    }

    @Test
    void nullContextAndNullEvaluationUseDocumentedFallback() {
        CaffeineEvaluationCache cache = CaffeineEvaluationCache.builder().build();
        assertThat(cache.getOrCompute("a", null, () -> null)).isFalse();
        assertThat(cache.size()).isZero();
        assertThat(cache.getOrCompute("a", null, () -> true)).isTrue();
    }

    @Test
    void invalidatingNullFeatureKeyOnlyRemovesThatFeature() {
        CaffeineEvaluationCache cache = CaffeineEvaluationCache.builder().build();
        assertThat(cache.getOrCompute(null, null, () -> true)).isTrue();
        assertThat(cache.getOrCompute("other", null, () -> false)).isFalse();

        cache.invalidateFeature(null);

        assertThat(cache.getOrCompute(null, null, () -> false)).isFalse();
        assertThat(cache.getOrCompute("other", null, () -> true)).isFalse();
    }

    private static boolean counted(AtomicInteger counter, boolean value) {
        counter.incrementAndGet();
        return value;
    }
}
