package io.toggly.cache.redis;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.HttpSnapshotProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Braces inside string literals must not truncate Redis feature-object parsing.
 */
@ExtendWith(MockitoExtension.class)
class RedisBraceInStringLiteralTest {

    @Mock
    private JedisPool pool;

    @Mock
    private Jedis jedis;

    private HttpSnapshotProvider http;
    private RedisCachingSnapshotProvider redis;

    @AfterEach
    void tearDown() {
        if (http != null) {
            http.close();
        }
    }

    @Test
    void bracesInsideParameterStringsDoNotTruncateFeatureParse() {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl("http://127.0.0.1:9")
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .useSignedDefinitions(false)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();

        http = new HttpSnapshotProvider(config);
        redis = new RedisCachingSnapshotProvider(http, pool, "toggly:brace:", Duration.ofMinutes(5));

        // Nested "{" / "}" inside a string value would truncate non-string-aware brace matching.
        String durableJson =
                "{\"features\":{\"feature-a\":{\"featureKey\":\"feature-a\",\"requirementType\":\"Any\","
                        + "\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{"
                        + "\"note\":\"value with { and } braces\"}}]},"
                        + "\"feature-b\":{\"featureKey\":\"feature-b\",\"requirementType\":\"Any\","
                        + "\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}},"
                        + "\"metrics\":{},\"timestamp\":\"2026-09-08T12:00:00Z\",\"etag\":\"rev-braces\"}";

        when(pool.getResource()).thenReturn(jedis);
        when(jedis.get(anyString())).thenReturn(durableJson);

        FeatureSnapshot loaded = redis.getSnapshot();
        assertThat(loaded.getFeatures().keySet()).containsExactlyInAnyOrder("feature-a", "feature-b");
        assertThat(loaded.getFeature("feature-a")).isNotNull();
        assertThat(loaded.getFeature("feature-b")).isNotNull();
        assertThat(loaded.getFeature("feature-a").getFilters()).isNotEmpty();
        assertThat(loaded.getFeature("feature-a").getFilters().get(0).getParameters())
                .containsEntry("note", "value with { and } braces");
    }
}
