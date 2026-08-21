using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Toggly.FeatureManagement.Context;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Filters
{
    internal static class ContextPropertyEvaluator
    {
        private const string FilterName = "ContextProperty";

        private static readonly HashSet<string> EqualityOperators = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "eq", "neq" };
        private static readonly HashSet<string> ComparisonOperators = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "gt", "gte", "lt", "lte" };
        private static readonly HashSet<string> InOperators = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "in" };
        private static readonly HashSet<string> ContainsOperators = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "contains" };

        public static bool IsContextPropertyFilter(FeatureFilter? filter) =>
            filter != null && string.Equals(filter.Name, FilterName, StringComparison.OrdinalIgnoreCase);

        public static IReadOnlyList<FeatureFilter> GetEntityFilters(FeatureDefinitionModel definition) =>
            definition.Filters.Where(IsContextPropertyFilter).ToList();

        public static IReadOnlyList<FeatureFilter> GetUserFilters(FeatureDefinitionModel definition) =>
            definition.Filters.Where(f => !IsContextPropertyFilter(f)).ToList();

        public static bool HasEntityFilters(FeatureDefinitionModel definition) =>
            definition.Filters.Any(IsContextPropertyFilter);

        public static bool HasUserFilters(FeatureDefinitionModel definition) =>
            definition.Filters.Any(f => !IsContextPropertyFilter(f));

        public static bool EvaluateEntityFilters(
            FeatureDefinitionModel definition,
            TogglyEntityContext entity)
        {
            var filters = GetEntityFilters(definition);
            if (filters.Count == 0)
                return false;

            var results = filters.Select(filter => EvaluateSingleFilter(filter, entity)).ToList();
            var all = IsAllRequirement(definition.ContextRequirementType ?? definition.RequirementType);
            return all ? results.All(r => r) : results.Any(r => r);
        }

        private static bool IsAllRequirement(RequirementType requirementType) =>
            requirementType == RequirementType.All;

        private static bool EvaluateSingleFilter(FeatureFilter filter, TogglyEntityContext entity)
        {
            var parameters = filter.Parameters ?? new Dictionary<string, string>();
            parameters.TryGetValue("Property", out var propertyName);
            parameters.TryGetValue("Operator", out var op);
            parameters.TryGetValue("Value", out var expectedValue);
            parameters.TryGetValue("ValueType", out var valueType);

            if (string.IsNullOrWhiteSpace(propertyName) || string.IsNullOrWhiteSpace(op) || expectedValue == null)
                return false;

            op = op.ToLowerInvariant();
            valueType = (valueType ?? "string").ToLowerInvariant();

            if (!entity.Attributes.TryGetValue(propertyName, out var actualValue))
                return false;

            return Compare(actualValue, op, expectedValue, valueType);
        }

        private static bool Compare(object? actual, string op, string expected, string valueType)
        {
            if (EqualityOperators.Contains(op))
                return CompareEquality(actual, expected, op == "eq");

            if (ComparisonOperators.Contains(op))
                return CompareOrdered(actual, expected, valueType, op);

            if (InOperators.Contains(op))
                return CompareIn(actual, expected);

            if (ContainsOperators.Contains(op))
                return CompareContains(actual, expected, valueType);

            return false;
        }

        private static bool CompareEquality(object? actual, string expected, bool shouldEqual)
        {
            var actualString = Convert.ToString(actual, CultureInfo.InvariantCulture) ?? string.Empty;
            var equal = string.Equals(actualString, expected, StringComparison.OrdinalIgnoreCase);
            return shouldEqual ? equal : !equal;
        }

        private static bool CompareOrdered(object? actual, string expected, string valueType, string op)
        {
            if (valueType == "datetime")
            {
                if (!TryParseDateTime(actual, out var actualDate) || !TryParseDateTime(expected, out var expectedDate))
                    return false;

                return op switch
                {
                    "gt" => actualDate > expectedDate,
                    "gte" => actualDate >= expectedDate,
                    "lt" => actualDate < expectedDate,
                    "lte" => actualDate <= expectedDate,
                    _ => false
                };
            }

            if (valueType == "number" && TryParseDecimal(actual, out var actualNumber) && decimal.TryParse(expected, NumberStyles.Any, CultureInfo.InvariantCulture, out var expectedNumber))
            {
                return op switch
                {
                    "gt" => actualNumber > expectedNumber,
                    "gte" => actualNumber >= expectedNumber,
                    "lt" => actualNumber < expectedNumber,
                    "lte" => actualNumber <= expectedNumber,
                    _ => false
                };
            }

            return false;
        }

        private static bool CompareIn(object? actual, string expected)
        {
            var candidates = expected
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(candidate => candidate.Trim())
                .Where(candidate => candidate.Length > 0);
            var actualString = Convert.ToString(actual, CultureInfo.InvariantCulture) ?? string.Empty;
            return candidates.Any(candidate => string.Equals(candidate, actualString, StringComparison.OrdinalIgnoreCase));
        }

        private static bool CompareContains(object? actual, string expected, string valueType)
        {
            if (valueType == "string[]" && actual is IEnumerable<object> values)
                return values.Any(v => string.Equals(Convert.ToString(v, CultureInfo.InvariantCulture), expected, StringComparison.OrdinalIgnoreCase));

            var actualString = Convert.ToString(actual, CultureInfo.InvariantCulture) ?? string.Empty;
            return actualString.Contains(expected, StringComparison.OrdinalIgnoreCase);
        }

        private static bool TryParseDateTime(object? value, out DateTimeOffset result)
        {
            result = default;
            if (value is DateTimeOffset dto)
            {
                result = dto;
                return true;
            }

            if (value is DateTime dt)
            {
                if (dt.Kind == DateTimeKind.Unspecified)
                    dt = DateTime.SpecifyKind(dt, DateTimeKind.Utc);
                result = new DateTimeOffset(dt);
                return true;
            }

            var text = Convert.ToString(value, CultureInfo.InvariantCulture);
            return !string.IsNullOrWhiteSpace(text) && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out result);
        }

        private static bool TryParseDecimal(object? value, out decimal result)
        {
            if (value is decimal d)
            {
                result = d;
                return true;
            }

            var text = Convert.ToString(value, CultureInfo.InvariantCulture);
            return decimal.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out result);
        }
    }
}
