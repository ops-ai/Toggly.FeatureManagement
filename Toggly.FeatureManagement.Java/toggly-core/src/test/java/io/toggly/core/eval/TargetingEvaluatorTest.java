package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class TargetingEvaluatorTest {

    private final TargetingEvaluator evaluator = TargetingEvaluator.INSTANCE;

    @Test
    void shouldMatchTargetedUser() {
        Map<String, Object> params = new HashMap<>();
        params.put("users", "user-123,user-456");

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .build();

        assertTrue(evaluator.evaluate(filter, "test-feature", context));
    }

    @Test
    void shouldNotMatchNonTargetedUser() {
        Map<String, Object> params = new HashMap<>();
        params.put("users", "user-123,user-456");

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        EvaluationContext context = EvaluationContext.builder()
                .identity("user-789")
                .build();

        assertFalse(evaluator.evaluate(filter, "test-feature", context));
    }

    @Test
    void shouldMatchTargetedGroup() {
        Map<String, Object> params = new HashMap<>();
        params.put("groups", "beta-testers,premium");

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .addGroup("beta-testers")
                .build();

        assertTrue(evaluator.evaluate(filter, "test-feature", context));
    }

    @Test
    void shouldNotMatchNonTargetedGroup() {
        Map<String, Object> params = new HashMap<>();
        params.put("groups", "beta-testers,premium");

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .addGroup("standard")
                .build();

        assertFalse(evaluator.evaluate(filter, "test-feature", context));
    }

    @Test
    void shouldSupportAudienceIndexedFormat() {
        Map<String, Object> params = new HashMap<>();
        params.put("Audience.Users:0", "admin@example.com");
        params.put("Audience.Users:1", "user@example.com");
        params.put("Audience.Groups:0", "admins");

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        EvaluationContext userContext = EvaluationContext.builder()
                .identity("admin@example.com")
                .build();

        EvaluationContext groupContext = EvaluationContext.builder()
                .identity("some-user")
                .addGroup("admins")
                .build();

        assertTrue(evaluator.evaluate(filter, "test", userContext));
        assertTrue(evaluator.evaluate(filter, "test", groupContext));
    }

    @Test
    void shouldApplyDefaultRolloutPercentage() {
        Map<String, Object> params = new HashMap<>();
        params.put("DefaultRolloutPercentage", 100);

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .build();

        assertTrue(evaluator.evaluate(filter, "test-feature", context));
    }

    @Test
    void shouldNotApplyDefaultPercentageWithoutIdentity() {
        Map<String, Object> params = new HashMap<>();
        params.put("DefaultRolloutPercentage", 100);

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        assertFalse(evaluator.evaluate(filter, "test-feature", EvaluationContext.empty()));
    }

    @Test
    void shouldPreferUserMatchOverPercentage() {
        Map<String, Object> params = new HashMap<>();
        params.put("users", "special-user");
        params.put("DefaultRolloutPercentage", 0);

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        EvaluationContext context = EvaluationContext.builder()
                .identity("special-user")
                .build();

        // User match should win even with 0% rollout
        assertTrue(evaluator.evaluate(filter, "test-feature", context));
    }

    @Test
    void shouldHandleMultipleGroups() {
        Map<String, Object> params = new HashMap<>();
        params.put("groups", "group-a");

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .groups(Set.of("group-b", "group-a", "group-c"))
                .build();

        assertTrue(evaluator.evaluate(filter, "test-feature", context));
    }
}
