using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace Toggly.FeatureManagement.Catalog
{
    /// <summary>
    /// A field-addressable catalog validation error.
    /// </summary>
    public sealed class CatalogValidationError
    {
        public CatalogValidationError(string path, string message)
        {
            Path = path;
            Message = message;
        }

        public string Path { get; private set; }

        public string Message { get; private set; }
    }

    /// <summary>
    /// Result of validation and optional canonical normalization.
    /// </summary>
    public sealed class CatalogValidationResult
    {
        internal CatalogValidationResult(CatalogDocument? document, IReadOnlyList<CatalogValidationError> errors)
        {
            Document = document;
            Errors = errors;
        }

        public CatalogDocument? Document { get; private set; }

        public IReadOnlyList<CatalogValidationError> Errors { get; private set; }

        public bool IsValid { get { return Errors.Count == 0; } }
    }

    /// <summary>
    /// Raised when a catalog cannot be accepted for use or persistence.
    /// </summary>
    public sealed class CatalogValidationException : Exception
    {
        public CatalogValidationException(IReadOnlyList<CatalogValidationError> errors)
            : base(string.Join("; ", errors.Select(error => error.Path + ": " + error.Message)))
        {
            Errors = errors;
        }

        public IReadOnlyList<CatalogValidationError> Errors { get; private set; }
    }

    /// <summary>
    /// Validates editable portable catalogs independently of a storage or evaluator implementation.
    /// </summary>
    public static class CatalogValidator
    {
        private static readonly Regex FeatureKeyPattern = new Regex("^[A-Za-z_][A-Za-z0-9_.:-]*$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
        private static readonly Regex ContextNamePattern = new Regex("^[A-Za-z][A-Za-z0-9_]{0,99}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
        private static readonly HashSet<string> ContextTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "string", "number", "boolean", "datetime", "string[]"
        };

        private static readonly HashSet<string> KnownFilters = new HashSet<string>(StringComparer.Ordinal)
        {
            "Percentage", "Targeting", "TimeWindow", "ContextProperty", "BrowserFamily", "BrowserLanguage",
            "OS", "DeviceType", "CountryFamily", "UserClaims"
        };

        /// <summary>
        /// Validates a catalog without changing the supplied instance.
        /// </summary>
        public static CatalogValidationResult Validate(CatalogDocument document)
        {
            if (document == null)
            {
                return Invalid("$", "Catalog document is required.");
            }

            return ValidateCore(document, normalize: false);
        }

        /// <summary>
        /// Creates a normalized catalog copy and validates the normalized content.
        /// </summary>
        public static CatalogValidationResult NormalizeAndValidate(CatalogDocument document)
        {
            if (document == null)
            {
                return Invalid("$", "Catalog document is required.");
            }

            var normalized = CloneAndNormalize(document);
            StampContextPropertyRules(normalized);
            return ValidateCore(normalized, normalize: true);
        }

        private static CatalogValidationResult ValidateCore(CatalogDocument document, bool normalize)
        {
            var errors = new List<CatalogValidationError>();
            if (document.SchemaVersion != 1)
            {
                errors.Add(new CatalogValidationError("schemaVersion", "Only schema version 1 is supported."));
            }

            if (!string.Equals(document.Environment, "Production", StringComparison.Ordinal))
            {
                errors.Add(new CatalogValidationError("environment", "The embedded catalog environment must be Production."));
            }

            if (document.Features == null)
            {
                errors.Add(new CatalogValidationError("features", "Feature collection must not be null."));
            }

            if (document.Contexts == null)
            {
                errors.Add(new CatalogValidationError("contexts", "Context collection must not be null."));
            }

            if (document.Features == null || document.Contexts == null)
            {
                return new CatalogValidationResult(normalize ? document : null, errors);
            }

            var contexts = ValidateContexts(document.Contexts, errors);
            ValidateFeatures(document.Features, contexts, errors);
            return new CatalogValidationResult(errors.Count == 0 && normalize ? document : null, errors);
        }

        private static Dictionary<string, CatalogContextSchema> ValidateContexts(
            IList<CatalogContextSchema> contexts,
            ICollection<CatalogValidationError> errors)
        {
            var result = new Dictionary<string, CatalogContextSchema>(StringComparer.OrdinalIgnoreCase);
            if (contexts.Count > 50)
            {
                errors.Add(new CatalogValidationError("contexts", "A catalog may contain at most 50 context kinds."));
            }

            for (var index = 0; index < contexts.Count; index++)
            {
                var context = contexts[index];
                var path = "contexts[" + index.ToString(CultureInfo.InvariantCulture) + "]";
                if (context == null)
                {
                    errors.Add(new CatalogValidationError(path, "Context must not be null."));
                    continue;
                }

                ValidateContextName(context.Kind, path + ".kind", "Context kind", errors);
                if (string.Equals(context.Kind, "User", StringComparison.OrdinalIgnoreCase))
                {
                    errors.Add(new CatalogValidationError(path + ".kind", "User is reserved for the built-in user context."));
                }
                if (!string.IsNullOrEmpty(context.Kind) && !result.TryAdd(context.Kind, context))
                {
                    errors.Add(new CatalogValidationError(path + ".kind", "Context kind duplicates an existing kind."));
                }

                if (context.Properties == null)
                {
                    errors.Add(new CatalogValidationError(path + ".properties", "Property collection must not be null."));
                    continue;
                }

                if (context.Properties.Count == 0)
                {
                    errors.Add(new CatalogValidationError(path + ".properties", "At least one context property is required."));
                }
                else if (context.Properties.Count > 100)
                {
                    errors.Add(new CatalogValidationError(path + ".properties", "A context may contain at most 100 properties."));
                }

                var propertyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (var propertyIndex = 0; propertyIndex < context.Properties.Count; propertyIndex++)
                {
                    var property = context.Properties[propertyIndex];
                    var propertyPath = path + ".properties[" + propertyIndex.ToString(CultureInfo.InvariantCulture) + "]";
                    if (property == null)
                    {
                        errors.Add(new CatalogValidationError(propertyPath, "Context property must not be null."));
                        continue;
                    }

                    ValidateContextName(property.Name, propertyPath + ".name", "Context property name", errors);
                    if (!ContextTypes.Contains(property.Type ?? string.Empty))
                    {
                        errors.Add(new CatalogValidationError(propertyPath + ".type", "Unsupported context property type."));
                    }

                    if (!string.IsNullOrEmpty(property.Name) && !propertyNames.Add(property.Name))
                    {
                        errors.Add(new CatalogValidationError(propertyPath + ".name", "Context property duplicates an existing property."));
                    }
                }

                if (string.IsNullOrWhiteSpace(context.KeyPropertyName))
                {
                    errors.Add(new CatalogValidationError(path + ".keyPropertyName", "Context key property name is required."));
                }
                else if (!context.Properties.Any(property => property != null && string.Equals(property.Name, context.KeyPropertyName, StringComparison.OrdinalIgnoreCase)))
                {
                    errors.Add(new CatalogValidationError(path + ".keyPropertyName", "Context key property name must name a declared context property."));
                }
            }

            return result;
        }

        private static void ValidateFeatures(
            IList<CatalogFeature> features,
            IReadOnlyDictionary<string, CatalogContextSchema> contexts,
            ICollection<CatalogValidationError> errors)
        {
            var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < features.Count; index++)
            {
                var feature = features[index];
                var path = "features[" + index.ToString(CultureInfo.InvariantCulture) + "]";
                if (feature == null)
                {
                    errors.Add(new CatalogValidationError(path, "Feature must not be null."));
                    continue;
                }

                ValidateIdentifier(feature.Key, path + ".key", "Feature key", errors);
                if (!string.IsNullOrEmpty(feature.Key) && !keys.Add(feature.Key))
                {
                    errors.Add(new CatalogValidationError(path + ".key", "Feature key duplicates an existing key."));
                }

                if (string.IsNullOrWhiteSpace(feature.Name) || feature.Name.Trim().Length > 200)
                {
                    errors.Add(new CatalogValidationError(path + ".name", "Feature name is required and must be at most 200 characters."));
                }

                if (feature.Description == null || feature.Description.Length > 8000)
                {
                    errors.Add(new CatalogValidationError(path + ".description", "Description must be plain text and at most 8,000 characters."));
                }

                if (!Enum.IsDefined(typeof(CatalogRequirementType), feature.RequirementType))
                {
                    errors.Add(new CatalogValidationError(path + ".requirementType", "Requirement type must be Any or All."));
                }

                if (feature.ContextRequirementType.HasValue && !Enum.IsDefined(typeof(CatalogRequirementType), feature.ContextRequirementType.Value))
                {
                    errors.Add(new CatalogValidationError(path + ".contextRequirementType", "Context requirement type must be Any or All."));
                }

                if (feature.ContextKind != null)
                {
                    ValidateContextName(feature.ContextKind, path + ".contextKind", "Context kind", errors);
                    if (!contexts.ContainsKey(feature.ContextKind))
                    {
                        errors.Add(new CatalogValidationError(path + ".contextKind", "Context kind is not defined in this catalog."));
                    }
                }

                ValidateTags(feature.Tags, path + ".tags", errors);
                if (feature.Rules == null)
                {
                    errors.Add(new CatalogValidationError(path + ".rules", "Rule collection must not be null."));
                    continue;
                }

                for (var ruleIndex = 0; ruleIndex < feature.Rules.Count; ruleIndex++)
                {
                    ValidateRule(feature, feature.Rules[ruleIndex], contexts, path + ".rules[" + ruleIndex.ToString(CultureInfo.InvariantCulture) + "]", errors);
                }
            }
        }

        private static void ValidateTags(IList<string>? tags, string path, ICollection<CatalogValidationError> errors)
        {
            if (tags == null)
            {
                errors.Add(new CatalogValidationError(path, "Tag collection must not be null."));
                return;
            }

            var values = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < tags.Count; index++)
            {
                var tag = tags[index];
                if (tag == null || tag.Trim().Length > 100)
                {
                    errors.Add(new CatalogValidationError(path + "[" + index.ToString(CultureInfo.InvariantCulture) + "]", "Tag must be at most 100 characters."));
                }
                else if (tag.Trim().Length > 0 && !values.Add(tag.Trim()))
                {
                    errors.Add(new CatalogValidationError(path + "[" + index.ToString(CultureInfo.InvariantCulture) + "]", "Tag duplicates an existing tag."));
                }
            }
        }

        private static void ValidateRule(
            CatalogFeature feature,
            CatalogRule rule,
            IReadOnlyDictionary<string, CatalogContextSchema> contexts,
            string path,
            ICollection<CatalogValidationError> errors)
        {
            if (rule == null)
            {
                errors.Add(new CatalogValidationError(path, "Rule must not be null."));
                return;
            }

            if (!KnownFilters.Contains(rule.Name ?? string.Empty))
            {
                errors.Add(new CatalogValidationError(path + ".name", "Unknown filter."));
                return;
            }

            if (rule.Parameters == null)
            {
                errors.Add(new CatalogValidationError(path + ".parameters", "Rule parameters must not be null."));
                return;
            }

            if (rule.Name == "Percentage")
            {
                ValidatePercentage(rule.Parameters, path, errors, "Value");
            }
            else if (rule.Name == "Targeting")
            {
                ValidateTargeting(rule.Parameters, path, errors);
            }
            else if (rule.Name == "TimeWindow")
            {
                ValidateTimeWindow(rule.Parameters, path, errors);
            }
            else if (rule.Name == "ContextProperty")
            {
                ValidateContextProperty(feature, rule.Parameters, contexts, path, errors);
            }
            else if (rule.Name == "UserClaims")
            {
                ValidateExactParameters(rule.Parameters, new[] { "Claim", "Value", "Percentage" }, new[] { "Claim", "Value", "Percentage" }, path, errors);
                ValidatePercentage(rule.Parameters, path, errors, "Percentage");
            }
            else
            {
                var prefix = rule.Name == "BrowserFamily" ? "BrowserFamily:" :
                    rule.Name == "BrowserLanguage" ? "BrowserLanguage:" :
                    rule.Name == "OS" ? "OperatingSystem:" :
                    rule.Name == "DeviceType" ? "DeviceType:" : "Country:";
                ValidateIndexedAndPercentage(rule.Parameters, prefix, path, errors);
            }
        }

        private static void ValidateTargeting(Dictionary<string, string> parameters, string path, ICollection<CatalogValidationError> errors)
        {
            foreach (var key in parameters.Keys)
            {
                if (key != "Audience.DefaultRolloutPercentage" && key != "IgnoreCase" &&
                    !IsIndexedKey(key, "Audience.Users:") && !IsIndexedKey(key, "Audience.Groups:") &&
                    !IsIndexedKey(key, "Audience.Exclusion.Users:") && !IsIndexedKey(key, "Audience.Exclusion.Groups:"))
                {
                    errors.Add(new CatalogValidationError(path + ".parameters." + key, "Unknown Targeting parameter."));
                }
            }

            ValidateIndexedParameters(parameters, "Audience.Users:", path, errors);
            ValidateIndexedParameters(parameters, "Audience.Groups:", path, errors);
            ValidateIndexedParameters(parameters, "Audience.Exclusion.Users:", path, errors);
            ValidateIndexedParameters(parameters, "Audience.Exclusion.Groups:", path, errors);
            ValidatePercentage(parameters, path, errors, "Audience.DefaultRolloutPercentage");
            if (parameters.TryGetValue("IgnoreCase", out var ignoreCase) && !bool.TryParse(ignoreCase, out _))
            {
                errors.Add(new CatalogValidationError(path + ".parameters.IgnoreCase", "IgnoreCase must be true or false."));
            }
        }

        private static void ValidateTimeWindow(Dictionary<string, string> parameters, string path, ICollection<CatalogValidationError> errors)
        {
            ValidateExactParameters(parameters, new[] { "Start", "End" }, new string[0], path, errors);
            var hasStart = TryGetDate(parameters, "Start", path, errors, out var start);
            var hasEnd = TryGetDate(parameters, "End", path, errors, out var end);
            if (!hasStart && !hasEnd)
            {
                errors.Add(new CatalogValidationError(path + ".parameters", "TimeWindow must specify Start, End, or both."));
            }
            else if (hasStart && hasEnd && start >= end)
            {
                errors.Add(new CatalogValidationError(path + ".parameters", "TimeWindow Start must precede End."));
            }
        }

        private static void ValidateContextProperty(
            CatalogFeature feature,
            Dictionary<string, string> parameters,
            IReadOnlyDictionary<string, CatalogContextSchema> contexts,
            string path,
            ICollection<CatalogValidationError> errors)
        {
            ValidateExactParameters(parameters, new[] { "ContextKind", "Property", "Operator", "Value", "ValueType" }, new[] { "Property", "Operator", "Value" }, path, errors);
            var contextKind = GetRequiredParameter(parameters, "ContextKind") ?? feature.ContextKind;
            if (string.IsNullOrWhiteSpace(contextKind) || !contexts.TryGetValue(contextKind, out var context))
            {
                errors.Add(new CatalogValidationError(path + ".parameters.ContextKind", "ContextKind must identify a defined context."));
                return;
            }

            if (feature.ContextKind == null || !string.Equals(feature.ContextKind, contextKind, StringComparison.OrdinalIgnoreCase))
            {
                errors.Add(new CatalogValidationError(path + ".parameters.ContextKind", "ContextProperty rule must match the feature context kind."));
            }

            var propertyName = GetRequiredParameter(parameters, "Property");
            var property = context.Properties == null ? null : context.Properties.FirstOrDefault(candidate => string.Equals(candidate.Name, propertyName, StringComparison.OrdinalIgnoreCase));
            if (property == null)
            {
                errors.Add(new CatalogValidationError(path + ".parameters.Property", "Property must identify a property in the context schema."));
                return;
            }

            var valueType = NormalizeContextType(property.Type);
            var op = GetRequiredParameter(parameters, "Operator");
            if (!IsOperatorAllowed(property.Type, op))
            {
                errors.Add(new CatalogValidationError(path + ".parameters.Operator", "Operator is not supported for this context property type."));
            }

            if (parameters.TryGetValue("Value", out var value))
            {
                ValidateContextValue(valueType, value, op, path + ".parameters.Value", errors);
            }
        }

        private static bool IsOperatorAllowed(string type, string? op)
        {
            op = op == null ? string.Empty : op.ToLowerInvariant();
            type = NormalizeContextType(type);
            if (op == "eq" || op == "neq") return true;
            if ((type == "number" || type == "datetime") && (op == "gt" || op == "gte" || op == "lt" || op == "lte")) return true;
            if ((type == "string" || type == "number" || type == "string[]") && op == "in") return true;
            return (type == "string" || type == "string[]") && op == "contains";
        }

        private static void ValidateContextValue(string type, string value, string? op, string path, ICollection<CatalogValidationError> errors)
        {
            if (!IsContextValueCompatible(value, type, op))
            {
                errors.Add(new CatalogValidationError(path, "Value is not valid for the context property type."));
            }
        }

        private static bool IsContextValueCompatible(string value, string valueType, string? op)
        {
            if (value == null) return false;
            var normalizedType = NormalizeContextType(valueType);
            if (string.Equals(op, "in", StringComparison.OrdinalIgnoreCase))
            {
                var parts = value.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(part => part.Trim())
                    .Where(part => part.Length > 0)
                    .ToList();
                return parts.Count > 0 && parts.All(part => IsSingleContextValueCompatible(part, normalizedType == "string[]" ? "string" : normalizedType));
            }

            return IsSingleContextValueCompatible(value, normalizedType);
        }

        private static bool IsSingleContextValueCompatible(string value, string valueType)
        {
            switch (valueType)
            {
                case "number":
                    return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out _);
                case "boolean":
                    return bool.TryParse(value, out _);
                case "datetime":
                    return DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _) ||
                        DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out _);
                case "string":
                case "string[]":
                    return value.Length > 0;
                default:
                    return false;
            }
        }

        private static void ValidateIndexedAndPercentage(Dictionary<string, string> parameters, string prefix, string path, ICollection<CatalogValidationError> errors)
        {
            foreach (var key in parameters.Keys)
            {
                if (key != "Percentage" && !IsIndexedKey(key, prefix))
                {
                    errors.Add(new CatalogValidationError(path + ".parameters." + key, "Unknown filter parameter."));
                }
            }

            ValidateIndexedParameters(parameters, prefix, path, errors);
            ValidatePercentage(parameters, path, errors, "Percentage");
        }

        private static void ValidateExactParameters(Dictionary<string, string> parameters, IEnumerable<string> allowed, IEnumerable<string> required, string path, ICollection<CatalogValidationError> errors)
        {
            var allowedKeys = new HashSet<string>(allowed, StringComparer.Ordinal);
            foreach (var key in parameters.Keys)
            {
                if (!allowedKeys.Contains(key))
                {
                    errors.Add(new CatalogValidationError(path + ".parameters." + key, "Unknown filter parameter."));
                }
            }

            foreach (var key in required)
            {
                if (!parameters.TryGetValue(key, out var value) || value == null)
                {
                    errors.Add(new CatalogValidationError(path + ".parameters." + key, "Required filter parameter is missing."));
                }
            }
        }

        private static void ValidatePercentage(Dictionary<string, string> parameters, string path, ICollection<CatalogValidationError> errors, string key)
        {
            if (!parameters.TryGetValue(key, out var value) ||
                !decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var percentage) ||
                percentage < 0m || percentage > 100m)
            {
                errors.Add(new CatalogValidationError(path + ".parameters." + key, "Percentage must be between 0 and 100."));
            }
        }

        private static void ValidateIndexedParameters(Dictionary<string, string> parameters, string prefix, string path, ICollection<CatalogValidationError> errors)
        {
            var indexes = new List<int>();
            foreach (var key in parameters.Keys.Where(key => key.StartsWith(prefix, StringComparison.Ordinal)))
            {
                if (!int.TryParse(key.Substring(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var index) || index < 0)
                {
                    errors.Add(new CatalogValidationError(path + ".parameters." + key, "Indexed parameter must use a non-negative integer index."));
                }
                else
                {
                    indexes.Add(index);
                }
            }

            indexes.Sort();
            for (var index = 0; index < indexes.Count; index++)
            {
                if (indexes[index] != index)
                {
                    errors.Add(new CatalogValidationError(path + ".parameters", "Indexed parameters must be contiguous and zero-based."));
                    break;
                }
            }
        }

        private static bool IsIndexedKey(string key, string prefix)
        {
            return key.StartsWith(prefix, StringComparison.Ordinal) &&
                int.TryParse(key.Substring(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var index) && index >= 0;
        }

        private static bool TryGetDate(Dictionary<string, string> parameters, string key, string path, ICollection<CatalogValidationError> errors, out DateTimeOffset value)
        {
            value = default(DateTimeOffset);
            if (!parameters.TryGetValue(key, out var text) || string.IsNullOrWhiteSpace(text))
            {
                return false;
            }

            if (!IsExplicitOffsetDate(text) || !DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out value))
            {
                errors.Add(new CatalogValidationError(path + ".parameters." + key, "Date must be ISO-8601 with an explicit offset."));
                return false;
            }

            return true;
        }

        private static bool IsExplicitOffsetDate(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return false;
            if (value.EndsWith("Z", StringComparison.Ordinal)) return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _);
            var separatorIndex = Math.Max(value.LastIndexOf('+'), value.LastIndexOf('-'));
            return separatorIndex > value.IndexOf('T') && separatorIndex + 6 == value.Length && value[separatorIndex + 3] == ':' &&
                DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _);
        }

        private static string? GetRequiredParameter(Dictionary<string, string> parameters, string key)
        {
            return parameters.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;
        }

        private static string NormalizeContextType(string type)
        {
            return string.Equals(type, "string[]", StringComparison.OrdinalIgnoreCase) ? "string[]" : (type ?? string.Empty).ToLowerInvariant();
        }

        private static void ValidateIdentifier(string value, string path, string displayName, ICollection<CatalogValidationError> errors)
        {
            if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || !FeatureKeyPattern.IsMatch(value))
            {
                errors.Add(new CatalogValidationError(path, displayName + " must be 1-128 characters and match [A-Za-z_][A-Za-z0-9_.:-]*."));
            }
        }

        private static void ValidateContextName(string value, string path, string displayName, ICollection<CatalogValidationError> errors)
        {
            if (string.IsNullOrWhiteSpace(value) || !ContextNamePattern.IsMatch(value))
            {
                errors.Add(new CatalogValidationError(path, displayName + " must match [A-Za-z][A-Za-z0-9_]{0,99}."));
            }
        }

        private static CatalogValidationResult Invalid(string path, string message)
        {
            return new CatalogValidationResult(null, new[] { new CatalogValidationError(path, message) });
        }

        private static CatalogDocument CloneAndNormalize(CatalogDocument source)
        {
            var document = new CatalogDocument
            {
                SchemaVersion = source.SchemaVersion,
                Environment = source.Environment == null ? string.Empty : source.Environment.Trim(),
                Features = source.Features == null ? null! : new List<CatalogFeature>(),
                Contexts = source.Contexts == null ? null! : new List<CatalogContextSchema>()
            };

            if (source.Features != null)
            {
                foreach (var sourceFeature in source.Features)
                {
                    if (sourceFeature == null)
                    {
                        document.Features.Add(null!);
                        continue;
                    }

                    var feature = new CatalogFeature
                    {
                        Key = sourceFeature.Key == null ? string.Empty : sourceFeature.Key.Trim(),
                        Name = sourceFeature.Name == null ? string.Empty : sourceFeature.Name.Trim(),
                        Description = sourceFeature.Description == null ? null! : sourceFeature.Description.Trim(),
                        Tags = NormalizeTags(sourceFeature.Tags),
                        Enabled = sourceFeature.Enabled,
                        RequirementType = sourceFeature.RequirementType,
                        ContextKind = string.IsNullOrWhiteSpace(sourceFeature.ContextKind) ? null : sourceFeature.ContextKind.Trim(),
                        ContextRequirementType = sourceFeature.ContextRequirementType,
                        Rules = CloneRules(sourceFeature.Rules)
                    };
                    document.Features.Add(feature);
                }
            }

            if (source.Contexts != null)
            {
                foreach (var sourceContext in source.Contexts)
                {
                    if (sourceContext == null)
                    {
                        document.Contexts.Add(null!);
                        continue;
                    }

                    var context = new CatalogContextSchema
                    {
                        Kind = sourceContext.Kind == null ? string.Empty : sourceContext.Kind.Trim(),
                        KeyPropertyName = sourceContext.KeyPropertyName == null ? string.Empty : sourceContext.KeyPropertyName.Trim(),
                        Properties = sourceContext.Properties == null ? null! : new List<CatalogContextProperty>()
                    };
                    if (sourceContext.Properties != null)
                    {
                        foreach (var sourceProperty in sourceContext.Properties)
                        {
                            context.Properties.Add(sourceProperty == null ? null! : new CatalogContextProperty
                            {
                                Name = sourceProperty.Name == null ? string.Empty : sourceProperty.Name.Trim(),
                                Type = sourceProperty.Type == null ? string.Empty : NormalizeContextType(sourceProperty.Type.Trim())
                            });
                        }
                    }

                    document.Contexts.Add(context);
                }
            }

            return document;
        }

        private static void StampContextPropertyRules(CatalogDocument document)
        {
            if (document.Features == null || document.Contexts == null) return;
            foreach (var feature in document.Features.Where(feature => feature != null && feature.Rules != null))
            {
                foreach (var rule in feature.Rules.Where(rule => rule != null && string.Equals(rule.Name, "ContextProperty", StringComparison.OrdinalIgnoreCase) && rule.Parameters != null))
                {
                    var kind = GetRequiredParameter(rule.Parameters, "ContextKind") ?? feature.ContextKind;
                    if (string.IsNullOrWhiteSpace(kind)) continue;
                    var context = document.Contexts.FirstOrDefault(candidate => candidate != null && string.Equals(candidate.Kind, kind, StringComparison.OrdinalIgnoreCase));
                    if (context == null || context.Properties == null) continue;
                    var propertyName = GetRequiredParameter(rule.Parameters, "Property");
                    var property = context.Properties.FirstOrDefault(candidate => candidate != null && string.Equals(candidate.Name, propertyName, StringComparison.OrdinalIgnoreCase));
                    if (property == null) continue;

                    rule.Parameters["ContextKind"] = context.Kind;
                    rule.Parameters["Property"] = property.Name;
                    rule.Parameters["ValueType"] = NormalizeContextType(property.Type);
                }
            }
        }

        private static List<string> NormalizeTags(List<string>? tags)
        {
            if (tags == null) return null!;
            return tags.Where(tag => !string.IsNullOrWhiteSpace(tag))
                .Select(tag => tag.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(tag => tag, StringComparer.Ordinal)
                .ToList();
        }

        private static List<CatalogRule> CloneRules(List<CatalogRule>? rules)
        {
            if (rules == null) return null!;
            return rules.Select(rule => rule == null ? null! : new CatalogRule
            {
                Name = rule.Name == null ? string.Empty : rule.Name.Trim(),
                Parameters = rule.Parameters == null ? null! : new Dictionary<string, string>(rule.Parameters, StringComparer.Ordinal)
            }).ToList();
        }
    }
}
