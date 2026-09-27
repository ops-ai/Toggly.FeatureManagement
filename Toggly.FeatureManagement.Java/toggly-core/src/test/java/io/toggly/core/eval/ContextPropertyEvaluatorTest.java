package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.context.TogglyEntityContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureRequirement;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ContextPropertyEvaluatorTest {

    @Test
    void eqAndDateTimeAndRequirementAndAndUser() {
        FeatureFilter color = FeatureFilter.of("ContextProperty", Map.of(
                "Property", "Color", "Operator", "eq", "Value", "red", "ValueType", "string"));
        FeatureFilter age = FeatureFilter.of("ContextProperty", Map.of(
                "Property", "Age", "Operator", "gte", "Value", "2", "ValueType", "number"));
        FeatureDefinition def = FeatureDefinition.builder()
                .featureKey("orders")
                .requirementType(FeatureRequirement.ANY)
                .contextRequirementType(FeatureRequirement.ALL)
                .filters(List.of(color, age, FeatureFilter.alwaysOn()))
                .build();

        TogglyEntityContext entity = new TogglyEntityContext("Order", "1", Map.of("Color", "red", "Age", 3));
        assertThat(ContextPropertyEvaluator.evaluateEntityFilters(def, entity)).isTrue();

        EvaluationEngine engine = new EvaluationEngine();
        EvaluationContext ctx = EvaluationContext.builder().entity(entity).build();
        assertThat(engine.evaluate(def, ctx)).isTrue();
        assertThat(engine.evaluate(def, EvaluationContext.empty())).isFalse();
    }

    @Test
    void operatorsFailClosed() {
        FeatureDefinition def = FeatureDefinition.builder()
                .featureKey("f")
                .requirementType(FeatureRequirement.ALL)
                .addFilter(FeatureFilter.of("ContextProperty", Map.of(
                        "Property", "Color", "Operator", "neq", "Value", "red", "ValueType", "string")))
                .build();
        TogglyEntityContext missing = new TogglyEntityContext("Order", "1", Map.of());
        assertThat(ContextPropertyEvaluator.evaluateEntityFilters(def, missing)).isFalse();

        FeatureDefinition unknownOp = FeatureDefinition.builder()
                .featureKey("f")
                .addFilter(FeatureFilter.of("ContextProperty", Map.of(
                        "Property", "Color", "Operator", "matches", "Value", "red", "ValueType", "string")))
                .build();
        assertThat(ContextPropertyEvaluator.evaluateEntityFilters(
                unknownOp, new TogglyEntityContext("Order", "1", Map.of("Color", "red")))).isFalse();
    }

    @Test
    void inContainsIgnoreCaseAndDatetime() {
        assertThat(ContextPropertyEvaluator.evaluateEntityFilters(
                definition("Color", "in", "red, blue", "string"),
                new TogglyEntityContext("P", "1", Map.of("color", "BLUE")))).isTrue();
        assertThat(ContextPropertyEvaluator.evaluateEntityFilters(
                definition("Name", "contains", "ord", "string"),
                new TogglyEntityContext("P", "1", Map.of("Name", "Order")))).isTrue();
        assertThat(ContextPropertyEvaluator.evaluateEntityFilters(
                definition("OrderDate", "gt", "2026-06-10T00:00:00Z", "datetime"),
                new TogglyEntityContext("Order", "42", Map.of(
                        "OrderDate", OffsetDateTime.of(2026, 7, 1, 0, 0, 0, 0, ZoneOffset.UTC))))).isTrue();
    }

    @Test
    void anyContextRequirement() {
        FeatureDefinition def = FeatureDefinition.builder()
                .featureKey("f")
                .requirementType(FeatureRequirement.ALL)
                .contextRequirementType(FeatureRequirement.ANY)
                .addFilter(FeatureFilter.of("ContextProperty", Map.of(
                        "Property", "Color", "Operator", "eq", "Value", "red", "ValueType", "string")))
                .addFilter(FeatureFilter.of("ContextProperty", Map.of(
                        "Property", "Color", "Operator", "eq", "Value", "blue", "ValueType", "string")))
                .build();
        TogglyEntityContext entity = new TogglyEntityContext("Order", "1", Map.of("Color", "red"));
        assertThat(ContextPropertyEvaluator.evaluateEntityFilters(def, entity)).isTrue();
    }

    @Test
    void orderedComparisonSupportsNumbersAndDateRepresentations() {
        assertThat(matches("age", "gt", "10", "number", 11)).isTrue();
        assertThat(matches("age", "lt", "10", "number", 9.5)).isTrue();
        assertThat(matches("age", "lte", "10", "number", 10)).isTrue();
        assertThat(matches("age", "gte", "10", "number", "10")).isTrue();
        assertThat(matches("age", "gt", "bad", "number", 11)).isFalse();
        assertThat(matches("age", "gt", "10", "number", "bad")).isFalse();
        assertThat(matches("age", "gt", "10", "string", "11")).isFalse();

        assertThat(matches("created", "gte", "2026-01-01", "datetime",
                Instant.parse("2026-01-01T00:00:00Z"))).isTrue();
        assertThat(matches("created", "lt", "2026-01-02", "datetime",
                Date.from(Instant.parse("2026-01-01T00:00:00Z")))).isTrue();
        assertThat(matches("created", "gt", "2025-12-31T00:00:00", "datetime",
                "2026-01-01T00:00:00")).isTrue();
        assertThat(matches("created", "gt", "invalid-date", "datetime", "2026-01-01")).isFalse();
        assertThat(matches("created", "gt", "2026-01-01", "datetime", "invalid-date")).isFalse();
    }

    @Test
    void containsHandlesCollectionsArraysAndMissingValues() {
        assertThat(matches("groups", "contains", "TEAM", "string[]", List.of("team", "other"))).isTrue();
        assertThat(matches("groups", "contains", "TEAM", "string[]", new String[]{"other", "team"})).isTrue();
        assertThat(matches("groups", "contains", "missing", "string[]", List.of("team"))).isFalse();
        assertThat(matches("groups", "contains", "missing", "string[]", new String[]{"team"})).isFalse();
        assertThat(matches("name", "contains", "BUY", "string", "buying")).isTrue();
        assertThat(matches("name", "in", "  , first, SECOND", "string", "second")).isTrue();
        assertThat(matches("name", "in", "first, second", "string", "third")).isFalse();
        assertThat(matches("name", "neq", "first", "string", "second")).isTrue();
        assertThat(ContextPropertyEvaluator.getEntityFilters(null)).isEmpty();
        assertThat(ContextPropertyEvaluator.getUserFilters(null)).isEmpty();
        assertThat(ContextPropertyEvaluator.isContextPropertyFilter(null)).isFalse();
    }

    private static boolean matches(String property, String op, String expected, String type, Object actual) {
        return ContextPropertyEvaluator.evaluateEntityFilters(
                definition(property, op, expected, type),
                new TogglyEntityContext("Order", "1", Map.of(property, actual)));
    }

    private static FeatureDefinition definition(String property, String op, String value, String type) {
        return FeatureDefinition.builder()
                .featureKey("f")
                .requirementType(FeatureRequirement.ALL)
                .addFilter(FeatureFilter.of("ContextProperty", Map.of(
                        "Property", property, "Operator", op, "Value", value, "ValueType", type)))
                .build();
    }
}
