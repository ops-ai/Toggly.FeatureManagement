package io.toggly.core.eval;

import io.toggly.core.model.FeatureFilter;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TimeWindowEvaluatorTest {

    @Test
    void acceptsCurrentWindowAndMissingOrMalformedBounds() {
        String past = Instant.now().minusSeconds(3600).toString();
        String future = Instant.now().plusSeconds(3600).toString();

        assertThat(evaluate(Map.of("Start", past, "End", future))).isTrue();
        assertThat(evaluate(Map.of("start", past, "end", future))).isTrue();
        assertThat(evaluate(Map.of())).isTrue();
        assertThat(evaluate(Map.of("Start", "not-a-date", "End", "not-a-date"))).isTrue();
        assertThat(evaluate(Map.of("Start", "", "End", ""))).isTrue();
    }

    @Test
    void rejectsNotStartedAndExpiredWindows() {
        String past = Instant.now().minusSeconds(3600).toString();
        String future = Instant.now().plusSeconds(3600).toString();

        assertThat(evaluate(Map.of("Start", future))).isFalse();
        assertThat(evaluate(Map.of("End", past))).isFalse();
        assertThat(evaluate(Map.of("Start", past, "End", past))).isFalse();
    }

    private static boolean evaluate(Map<String, Object> parameters) {
        return TimeWindowEvaluator.INSTANCE.evaluate(FeatureFilter.of("TimeWindow", parameters), "flag", null);
    }
}
