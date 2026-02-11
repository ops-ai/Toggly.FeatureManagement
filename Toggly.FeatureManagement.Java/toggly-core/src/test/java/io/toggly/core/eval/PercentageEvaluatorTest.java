package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class PercentageEvaluatorTest {

    private final PercentageEvaluator evaluator = PercentageEvaluator.INSTANCE;

    @Test
    void shouldReturnFalseForZeroPercentage() {
        FeatureFilter filter = createFilter(0);
        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .build();

        assertFalse(evaluator.evaluate(filter, "test-feature", context));
    }

    @Test
    void shouldReturnTrueForHundredPercentage() {
        FeatureFilter filter = createFilter(100);
        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .build();

        assertTrue(evaluator.evaluate(filter, "test-feature", context));
    }

    @Test
    void shouldReturnFalseWithoutIdentity() {
        FeatureFilter filter = createFilter(50);
        EvaluationContext context = EvaluationContext.empty();

        assertFalse(evaluator.evaluate(filter, "test-feature", context));
    }

    @Test
    void shouldBeDeterministicForSameUserAndFeature() {
        FeatureFilter filter = createFilter(50);
        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .build();

        boolean result1 = evaluator.evaluate(filter, "test-feature", context);
        boolean result2 = evaluator.evaluate(filter, "test-feature", context);

        assertEquals(result1, result2);
    }

    @Test
    void shouldProduceDifferentResultsForDifferentFeatures() {
        FeatureFilter filter = createFilter(50);
        EvaluationContext context = EvaluationContext.builder()
                .identity("consistent-user")
                .build();

        // Different features may produce different results
        Set<Boolean> results = new HashSet<>();
        for (int i = 0; i < 100; i++) {
            results.add(evaluator.evaluate(filter, "feature-" + i, context));
        }

        // With 50% and 100 features, we should see both true and false
        assertTrue(results.contains(true));
        assertTrue(results.contains(false));
    }

    @Test
    void shouldDistributeRoughlyEvenlyAt50Percent() {
        FeatureFilter filter = createFilter(50);
        String featureKey = "test-feature";

        int trueCount = 0;
        int totalUsers = 10000;

        for (int i = 0; i < totalUsers; i++) {
            EvaluationContext context = EvaluationContext.builder()
                    .identity("user-" + i)
                    .build();
            if (evaluator.evaluate(filter, featureKey, context)) {
                trueCount++;
            }
        }

        // Allow 5% deviation
        double percentage = (double) trueCount / totalUsers * 100;
        assertTrue(percentage > 45 && percentage < 55,
                "Expected ~50%, got " + percentage + "%");
    }

    @Test
    void shouldSupportValueParameter() {
        Map<String, Object> params = new HashMap<>();
        params.put("Value", 75.0);
        FeatureFilter filter = FeatureFilter.of("Percentage", params);

        int trueCount = 0;
        for (int i = 0; i < 1000; i++) {
            EvaluationContext context = EvaluationContext.builder()
                    .identity("user-" + i)
                    .build();
            if (evaluator.evaluate(filter, "test", context)) {
                trueCount++;
            }
        }

        double percentage = (double) trueCount / 1000 * 100;
        assertTrue(percentage > 65 && percentage < 85,
                "Expected ~75%, got " + percentage + "%");
    }

    private FeatureFilter createFilter(double percentage) {
        return FeatureFilter.percentage(percentage);
    }
}
