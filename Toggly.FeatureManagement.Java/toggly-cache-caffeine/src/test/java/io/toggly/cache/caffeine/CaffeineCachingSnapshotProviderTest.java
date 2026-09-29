package io.toggly.cache.caffeine;

import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.SnapshotProvider;
import io.toggly.core.telemetry.DefinitionCacheRecorder;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class CaffeineCachingSnapshotProviderTest {

    @Test
    void cachesFirstRefreshUntilExplicitRefresh() {
        FakeProvider source = new FakeProvider();
        CaffeineCachingSnapshotProvider cached = new CaffeineCachingSnapshotProvider(source);

        FeatureSnapshot first = cached.getSnapshot();
        assertThat(cached.getSnapshot()).isSameAs(first);
        assertThat(source.refreshCount).hasValue(1);

        FeatureSnapshot second = cached.refresh();
        assertThat(second).isNotSameAs(first);
        assertThat(source.refreshCount).hasValue(2);
        assertThat(cached.getSnapshot()).isSameAs(second);
    }

    @Test
    void asynchronousReadsAndRefreshesUseTheSameCache() {
        FakeProvider source = new FakeProvider();
        CaffeineCachingSnapshotProvider cached = new CaffeineCachingSnapshotProvider(source);

        FeatureSnapshot first = cached.getSnapshotAsync().join();
        assertThat(cached.getSnapshotAsync().join()).isSameAs(first);
        FeatureSnapshot second = cached.refreshAsync().join();
        assertThat(second).isNotSameAs(first);
        assertThat(cached.getSnapshot()).isSameAs(second);
        assertThat(source.refreshCount).hasValue(2);
    }

    @Test
    void failedRefreshFallsBackToDelegateSnapshot() {
        FakeProvider source = new FakeProvider();
        source.failRefresh = true;
        CaffeineCachingSnapshotProvider cached = new CaffeineCachingSnapshotProvider(source);

        assertThat(cached.getSnapshot().getEtag()).isEqualTo("fallback");
        assertThat(source.refreshCount).hasValue(1);
    }

    @Test
    void nullRefreshReturnsEmptySnapshotWithoutCachingIt() {
        FakeProvider source = new FakeProvider();
        source.returnNull = true;
        CaffeineCachingSnapshotProvider cached = new CaffeineCachingSnapshotProvider(source);

        assertThat(cached.getSnapshot()).isNotNull();
        assertThat(cached.getSnapshot().isEmpty()).isTrue();
        assertThat(source.refreshCount).hasValue(2);
    }

    @Test
    void customConfigurationRecordsHitsAndForwardsLifecycle() {
        FakeProvider source = new FakeProvider();
        CaffeineCacheConfig config = CaffeineCacheConfig.builder()
                .expireAfterWrite(Duration.ofMinutes(1))
                .refreshAfterWrite(Duration.ofSeconds(30))
                .maximumSize(1)
                .recordStats()
                .build();
        CaffeineCachingSnapshotProvider cached = new CaffeineCachingSnapshotProvider(source, config);
        DefinitionCacheRecorder recorder = new DefinitionCacheRecorder() {
            @Override
            public void recordDefinitionCacheHit() {
                throw new UnsupportedOperationException("Recorder callbacks are not expected in this forwarding test");
            }

            @Override
            public void recordDefinitionCacheMiss() {
                throw new UnsupportedOperationException("Recorder callbacks are not expected in this forwarding test");
            }
        };

        cached.getSnapshot();
        cached.getSnapshot();
        assertThat(cached.stats().hitCount()).isEqualTo(1);
        cached.setDefinitionCacheRecorder(recorder);
        assertThat(source.recorder).isSameAs(recorder);
        cached.clearJwks();
        assertThat(source.clearJwksCount).hasValue(1);

        cached.clear();
        assertThat(source.clearCount).hasValue(1);
        cached.getSnapshot();
        assertThat(source.refreshCount).hasValue(2);

        cached.invalidate();
        assertThat(source.clearCount).hasValue(2);
        cached.close();
        assertThat(source.closeCount).hasValue(1);
    }

    @Test
    void defaultConfigurationHasFiniteExpiryAndRefresh() {
        CaffeineCacheConfig defaults = CaffeineCacheConfig.defaults();
        assertThat(defaults.getExpireAfterWrite()).isEqualTo(Duration.ofMinutes(1));
        assertThat(defaults.getRefreshAfterWrite()).isEqualTo(Duration.ofSeconds(30));
        assertThat(defaults.getMaximumSize()).isZero();
        assertThat(defaults.isRecordStats()).isFalse();
    }

    private static final class FakeProvider implements SnapshotProvider {
        private final AtomicInteger refreshCount = new AtomicInteger();
        private final AtomicInteger clearCount = new AtomicInteger();
        private final AtomicInteger clearJwksCount = new AtomicInteger();
        private final AtomicInteger closeCount = new AtomicInteger();
        private boolean failRefresh;
        private boolean returnNull;
        private DefinitionCacheRecorder recorder;

        @Override
        public FeatureSnapshot getSnapshot() {
            return new FeatureSnapshot(null, null, null, "fallback");
        }

        @Override
        public FeatureSnapshot refresh() {
            int count = refreshCount.incrementAndGet();
            if (failRefresh) {
                throw new IllegalStateException("source unavailable");
            }
            return returnNull ? null : new FeatureSnapshot(null, null, null, "refresh-" + count);
        }

        @Override
        public void clear() {
            clearCount.incrementAndGet();
        }

        @Override
        public void clearJwks() {
            clearJwksCount.incrementAndGet();
        }

        @Override
        public void setDefinitionCacheRecorder(DefinitionCacheRecorder value) {
            recorder = value;
        }

        @Override
        public void close() {
            closeCount.incrementAndGet();
        }
    }
}
