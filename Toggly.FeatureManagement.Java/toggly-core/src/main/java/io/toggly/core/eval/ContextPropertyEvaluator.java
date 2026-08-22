package io.toggly.core.eval;

import io.toggly.core.context.TogglyEntityContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureRequirement;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/**
 * Evaluates ContextProperty filters against an entity. Unknown operators fail closed.
 */
public final class ContextPropertyEvaluator implements FilterEvaluator {

    public static final String FILTER_NAME = "ContextProperty";
    public static final ContextPropertyEvaluator INSTANCE = new ContextPropertyEvaluator();

    private ContextPropertyEvaluator() {}

    public static boolean isContextPropertyFilter(FeatureFilter filter) {
        return filter != null && FILTER_NAME.equalsIgnoreCase(filter.getName());
    }

    public static List<FeatureFilter> getEntityFilters(FeatureDefinition definition) {
        List<FeatureFilter> out = new ArrayList<>();
        if (definition == null || definition.getFilters() == null) {
            return out;
        }
        for (FeatureFilter filter : definition.getFilters()) {
            if (isContextPropertyFilter(filter)) {
                out.add(filter);
            }
        }
        return out;
    }

    public static List<FeatureFilter> getUserFilters(FeatureDefinition definition) {
        List<FeatureFilter> out = new ArrayList<>();
        if (definition == null || definition.getFilters() == null) {
            return out;
        }
        for (FeatureFilter filter : definition.getFilters()) {
            if (!isContextPropertyFilter(filter)) {
                out.add(filter);
            }
        }
        return out;
    }

    public static boolean evaluateEntityFilters(FeatureDefinition definition, TogglyEntityContext entity) {
        List<FeatureFilter> filters = getEntityFilters(definition);
        if (filters.isEmpty() || entity == null) {
            return false;
        }
        FeatureRequirement requirement = definition.getContextRequirementType() != null
                ? definition.getContextRequirementType()
                : definition.getRequirementType();
        boolean all = requirement == FeatureRequirement.ALL;
        if (all) {
            for (FeatureFilter filter : filters) {
                if (!evaluateSingleFilter(filter, entity)) {
                    return false;
                }
            }
            return true;
        }
        for (FeatureFilter filter : filters) {
            if (evaluateSingleFilter(filter, entity)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, io.toggly.core.context.EvaluationContext context) {
        if (context == null || context.getEntity() == null) {
            return false;
        }
        return evaluateSingleFilter(filter, context.getEntity());
    }

    static boolean evaluateSingleFilter(FeatureFilter filter, TogglyEntityContext entity) {
        String propertyName = param(filter, "Property");
        String op = param(filter, "Operator");
        String expectedValue = param(filter, "Value");
        String valueType = param(filter, "ValueType");
        if (propertyName == null || propertyName.isBlank() || op == null || op.isBlank() || expectedValue == null) {
            return false;
        }
        op = op.toLowerCase(Locale.ROOT);
        if (valueType == null || valueType.isBlank()) {
            valueType = "string";
        } else {
            valueType = valueType.toLowerCase(Locale.ROOT);
        }
        if (!entity.containsAttribute(propertyName)) {
            return false;
        }
        return compare(entity.getAttribute(propertyName), op, expectedValue, valueType);
    }

    private static String param(FeatureFilter filter, String key) {
        Object value = filter.getParameters().get(key);
        if (value == null) {
            for (var entry : filter.getParameters().entrySet()) {
                if (key.equalsIgnoreCase(entry.getKey()) && entry.getValue() != null) {
                    return String.valueOf(entry.getValue());
                }
            }
            return null;
        }
        return String.valueOf(value);
    }

    private static boolean compare(Object actual, String op, String expected, String valueType) {
        return switch (op) {
            case "eq" -> compareEquality(actual, expected, true);
            case "neq" -> compareEquality(actual, expected, false);
            case "gt", "gte", "lt", "lte" -> compareOrdered(actual, expected, valueType, op);
            case "in" -> compareIn(actual, expected);
            case "contains" -> compareContains(actual, expected, valueType);
            default -> false;
        };
    }

    private static boolean compareEquality(Object actual, String expected, boolean shouldEqual) {
        String actualString = actual == null ? "" : String.valueOf(actual);
        boolean equal = actualString.equalsIgnoreCase(expected);
        return shouldEqual == equal;
    }

    private static boolean compareOrdered(Object actual, String expected, String valueType, String op) {
        if ("datetime".equals(valueType)) {
            OffsetDateTime actualDate = parseDateTime(actual);
            OffsetDateTime expectedDate = parseDateTime(expected);
            if (actualDate == null || expectedDate == null) {
                return false;
            }
            int cmp = actualDate.compareTo(expectedDate);
            return ordered(cmp, op);
        }
        if ("number".equals(valueType)) {
            BigDecimal actualNumber = parseDecimal(actual);
            BigDecimal expectedNumber = parseDecimal(expected);
            if (actualNumber == null || expectedNumber == null) {
                return false;
            }
            return ordered(actualNumber.compareTo(expectedNumber), op);
        }
        return false;
    }

    private static boolean ordered(int cmp, String op) {
        return switch (op) {
            case "gt" -> cmp > 0;
            case "gte" -> cmp >= 0;
            case "lt" -> cmp < 0;
            case "lte" -> cmp <= 0;
            default -> false;
        };
    }

    private static boolean compareIn(Object actual, String expected) {
        String actualString = actual == null ? "" : String.valueOf(actual);
        for (String candidate : expected.split(",")) {
            String trimmed = candidate.trim();
            if (!trimmed.isEmpty() && trimmed.equalsIgnoreCase(actualString)) {
                return true;
            }
        }
        return false;
    }

    private static boolean compareContains(Object actual, String expected, String valueType) {
        if ("string[]".equals(valueType) && actual instanceof Collection<?> values) {
            for (Object value : values) {
                if (String.valueOf(value).equalsIgnoreCase(expected)) {
                    return true;
                }
            }
            return false;
        }
        if ("string[]".equals(valueType) && actual != null && actual.getClass().isArray()) {
            int length = java.lang.reflect.Array.getLength(actual);
            for (int i = 0; i < length; i++) {
                Object value = java.lang.reflect.Array.get(actual, i);
                if (String.valueOf(value).equalsIgnoreCase(expected)) {
                    return true;
                }
            }
            return false;
        }
        String actualString = actual == null ? "" : String.valueOf(actual);
        return actualString.toLowerCase(Locale.ROOT).contains(expected.toLowerCase(Locale.ROOT));
    }

    private static OffsetDateTime parseDateTime(Object value) {
        if (value instanceof OffsetDateTime odt) {
            return odt;
        }
        if (value instanceof java.time.Instant instant) {
            return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
        }
        if (value instanceof java.util.Date date) {
            return OffsetDateTime.ofInstant(date.toInstant(), ZoneOffset.UTC);
        }
        String text = value == null ? null : String.valueOf(value);
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(text, DateTimeFormatter.ISO_DATE_TIME);
        } catch (DateTimeParseException ignored) {
            try {
                return java.time.LocalDateTime.parse(text).atOffset(ZoneOffset.UTC);
            } catch (DateTimeParseException ignored2) {
                try {
                    return java.time.LocalDate.parse(text).atStartOfDay().atOffset(ZoneOffset.UTC);
                } catch (DateTimeParseException e) {
                    return null;
                }
            }
        }
    }

    private static BigDecimal parseDecimal(Object value) {
        if (value instanceof BigDecimal bd) {
            return bd;
        }
        if (value instanceof Number number) {
            return new BigDecimal(number.toString());
        }
        try {
            return new BigDecimal(String.valueOf(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
