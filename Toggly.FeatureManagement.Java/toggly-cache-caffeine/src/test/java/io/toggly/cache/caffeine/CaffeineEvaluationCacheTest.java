package io.toggly.cache.caffeine;

import io.toggly.core.context.EvaluationContext;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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

    @Test
    void keepsCollidingTraitAndClaimContextsInSeparateEntries() {
        CaffeineEvaluationCache cache = CaffeineEvaluationCache.builder().build();
        AtomicInteger computations = new AtomicInteger();
        EvaluationContext traitAa = EvaluationContext.builder()
                .identity("same-user")
                .trait("segment", "Aa")
                .build();
        EvaluationContext traitBb = EvaluationContext.builder()
                .identity("same-user")
                .trait("segment", "BB")
                .build();
        EvaluationContext claimAa = EvaluationContext.builder()
                .identity("same-user")
                .claim("role", "Aa")
                .build();
        EvaluationContext claimBb = EvaluationContext.builder()
                .identity("same-user")
                .claim("role", "BB")
                .build();

        assertThat("Aa".hashCode()).isEqualTo("BB".hashCode());
        assertThat(traitAa).isNotEqualTo(traitBb);
        assertThat(traitAa.hashCode()).isEqualTo(traitBb.hashCode());
        assertThat(claimAa).isNotEqualTo(claimBb);
        assertThat(claimAa.hashCode()).isEqualTo(claimBb.hashCode());

        assertThat(cache.getOrCompute("targeted", traitAa, () -> counted(computations, true))).isTrue();
        assertThat(cache.getOrCompute("targeted", traitBb, () -> counted(computations, false))).isFalse();
        assertThat(cache.getOrCompute("targeted", claimAa, () -> counted(computations, true))).isTrue();
        assertThat(cache.getOrCompute("targeted", claimBb, () -> counted(computations, false))).isFalse();
        assertThat(computations).hasValue(4);
    }

    @Test
    void invalidatesEveryContextEntryForAFeature() {
        CaffeineEvaluationCache cache = CaffeineEvaluationCache.builder().build();
        AtomicInteger computations = new AtomicInteger();
        EvaluationContext paid = EvaluationContext.forIdentity("user").withTrait("plan", "paid");
        EvaluationContext trial = EvaluationContext.forIdentity("user").withTrait("plan", "trial");

        assertThat(cache.getOrCompute("checkout", paid, () -> counted(computations, true))).isTrue();
        assertThat(cache.getOrCompute("checkout", trial, () -> counted(computations, true))).isTrue();

        cache.invalidateFeature("checkout");

        assertThat(cache.getOrCompute("checkout", paid, () -> counted(computations, false))).isFalse();
        assertThat(cache.getOrCompute("checkout", trial, () -> counted(computations, false))).isFalse();
        assertThat(computations).hasValue(4);
    }

    @Test
    void retainsNoMoreThanTheConfiguredMaximumNumberOfEntries() {
        CaffeineEvaluationCache cache = CaffeineEvaluationCache.builder().maximumSize(1).build();
        EvaluationContext context = EvaluationContext.forIdentity("user");

        cache.getOrCompute("one", context, () -> true);
        cache.getOrCompute("two", context, () -> true);
        cache.getOrCompute("three", context, () -> true);

        assertThat(cache.size()).isLessThanOrEqualTo(1);
    }

    @Test
    void computesOneSharedContextOnlyOnceUnderConcurrentAccess() throws Exception {
        CaffeineEvaluationCache cache = CaffeineEvaluationCache.builder().build();
        AtomicInteger computations = new AtomicInteger();
        CountDownLatch workersReady = new CountDownLatch(8);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService workers = Executors.newFixedThreadPool(8);

        try {
            List<Future<Boolean>> results = new ArrayList<>();
            for (int worker = 0; worker < 8; worker++) {
                results.add(workers.submit(() -> {
                    workersReady.countDown();
                    start.await();
                    return cache.getOrCompute("concurrent", EvaluationContext.forIdentity("user"), () -> {
                        computations.incrementAndGet();
                        sleepBriefly();
                        return true;
                    });
                }));
            }

            assertThat(workersReady.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            for (Future<Boolean> result : results) {
                assertThat(result.get(5, TimeUnit.SECONDS)).isTrue();
            }
            assertThat(computations).hasValue(1);
        } finally {
            workers.shutdownNow();
            assertThat(workers.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    private static boolean counted(AtomicInteger counter, boolean value) {
        counter.incrementAndGet();
        return value;
    }

    private static void sleepBriefly() {
        try {
            TimeUnit.MILLISECONDS.sleep(25);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Interrupted while simulating concurrent evaluation", exception);
        }
    }
}
