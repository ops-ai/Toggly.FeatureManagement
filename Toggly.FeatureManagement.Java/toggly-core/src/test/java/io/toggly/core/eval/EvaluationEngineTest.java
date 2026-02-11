package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureRequirement;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class EvaluationEngineTest {

    private EvaluationEngine engine;

    @BeforeEach
    void setUp() {
        engine = new EvaluationEngine();
    }

    @Test
    void shouldReturnFalseForNullDefinition() {
        assertFalse(engine.evaluate(null, EvaluationContext.empty()));
    }

    @Test
    void shouldReturnFalseForNoFilters() {
        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("test-feature")
                .build();

        assertFalse(engine.evaluate(definition, EvaluationContext.empty()));
    }

    @Test
    void shouldReturnTrueForAlwaysOnFilter() {
        FeatureFilter filter = FeatureFilter.alwaysOn();

        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("test-feature")
                .filters(List.of(filter))
                .build();

        assertTrue(engine.evaluate(definition, EvaluationContext.empty()));
    }

    @Test
    void shouldRequireAllFiltersWhenRequirementIsAll() {
        FeatureFilter alwaysOn = FeatureFilter.alwaysOn();
        FeatureFilter percentage = FeatureFilter.percentage(0);

        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("test-feature")
                .requirementType(FeatureRequirement.ALL)
                .filters(Arrays.asList(alwaysOn, percentage))
                .build();

        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .build();

        // AlwaysOn passes, but Percentage(0) fails
        assertFalse(engine.evaluate(definition, context));
    }

    @Test
    void shouldRequireAnyFilterWhenRequirementIsAny() {
        FeatureFilter alwaysOn = FeatureFilter.alwaysOn();
        FeatureFilter percentage = FeatureFilter.percentage(0);

        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("test-feature")
                .requirementType(FeatureRequirement.ANY)
                .filters(Arrays.asList(alwaysOn, percentage))
                .build();

        EvaluationContext context = EvaluationContext.builder()
                .identity("user-123")
                .build();

        // AlwaysOn passes, so result is true
        assertTrue(engine.evaluate(definition, context));
    }

    @Test
    void shouldEvaluateGateWithAllRequirement() {
        Map<String, FeatureDefinition> definitions = createDefinitions();

        List<String> featureKeys = Arrays.asList("feature-a", "feature-b");

        // Both features have AlwaysOn filter
        assertTrue(engine.evaluateGate(
                definitions, featureKeys, EvaluationContext.empty(),
                FeatureRequirement.ALL, false));
    }

    @Test
    void shouldEvaluateGateWithAnyRequirement() {
        Map<String, FeatureDefinition> definitions = new HashMap<>();
        definitions.put("feature-a", createAlwaysOnFeature("feature-a"));
        definitions.put("feature-b", FeatureDefinition.builder()
                .featureKey("feature-b")
                .build()); // No filters = disabled

        List<String> featureKeys = Arrays.asList("feature-a", "feature-b");

        assertTrue(engine.evaluateGate(
                definitions, featureKeys, EvaluationContext.empty(),
                FeatureRequirement.ANY, false));
    }

    @Test
    void shouldNegateGateResult() {
        Map<String, FeatureDefinition> definitions = createDefinitions();

        List<String> featureKeys = Arrays.asList("feature-a");

        // feature-a is enabled, negate should return false
        assertFalse(engine.evaluateGate(
                definitions, featureKeys, EvaluationContext.empty(),
                FeatureRequirement.ALL, true));
    }

    @Test
    void shouldReturnTrueForEmptyFeatureKeysWithoutNegate() {
        assertTrue(engine.evaluateGate(
                new HashMap<>(), List.of(), EvaluationContext.empty(),
                FeatureRequirement.ALL, false));
    }

    @Test
    void shouldEvaluateWithDefaults() {
        Map<String, Boolean> defaults = new HashMap<>();
        defaults.put("feature-a", true);
        defaults.put("feature-b", false);

        // Null definition should use defaults
        assertTrue(engine.evaluateWithDefaults(
                null, EvaluationContext.empty(), "feature-a", defaults, false));
        assertFalse(engine.evaluateWithDefaults(
                null, EvaluationContext.empty(), "feature-b", defaults, false));

        // Unknown feature should use default value
        assertTrue(engine.evaluateWithDefaults(
                null, EvaluationContext.empty(), "unknown", defaults, true));
        assertFalse(engine.evaluateWithDefaults(
                null, EvaluationContext.empty(), "unknown", defaults, false));
    }

    @Test
    void shouldUseDefinitionOverDefaults() {
        Map<String, Boolean> defaults = new HashMap<>();
        defaults.put("feature-a", false); // Default is false

        FeatureDefinition definition = createAlwaysOnFeature("feature-a");

        // Definition says enabled, should override default
        assertTrue(engine.evaluateWithDefaults(
                definition, EvaluationContext.empty(), "feature-a", defaults, false));
    }

    private Map<String, FeatureDefinition> createDefinitions() {
        Map<String, FeatureDefinition> definitions = new HashMap<>();
        definitions.put("feature-a", createAlwaysOnFeature("feature-a"));
        definitions.put("feature-b", createAlwaysOnFeature("feature-b"));
        return definitions;
    }

    private FeatureDefinition createAlwaysOnFeature(String key) {
        FeatureFilter filter = FeatureFilter.alwaysOn();

        return FeatureDefinition.builder()
                .featureKey(key)
                .filters(List.of(filter))
                .build();
    }
}
