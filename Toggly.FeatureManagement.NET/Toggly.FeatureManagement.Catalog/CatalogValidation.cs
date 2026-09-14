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
        private static readonly Regex FeatureKeyPattern = new Regex("^[A-Za-z_][A-Za-z0-9_.:-]*$", RegexOptions.Compiled | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(250));
        private static readonly Regex ContextNamePattern = new Regex("^[A-Za-z][A-Za-z0-9_]{0,99}$", RegexOptions.Compiled | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(250));
        private const string TypeString = "string";
        private const string TypeNumber = "number";
        private const string TypeStringArray = "string[]";
        private const string FilterPercentage = "Percentage";
        private const string ParamValue = "Value";
        private const string ParamContextKind = "ContextKind";
        private const string ParamProperty = "Property";
        private const string FilterAlwaysOn = "AlwaysOn";
        private const string FilterTargeting = "Targeting";
        private const string FilterTimeWindow = "TimeWindow";
        private const string FilterContextProperty = "ContextProperty";
        private const string FilterBrowserFamily = "BrowserFamily";
        private const string FilterBrowserLanguage = "BrowserLanguage";
        private const string FilterUserClaims = "UserClaims";
        private const string PathName = ".name";
        private const string PathParameters = ".parameters";
        private const string PathParametersPrefix = ".parameters.";

        private static readonly HashSet<string> ContextTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            TypeString, TypeNumber, "boolean", "datetime", TypeStringArray
        };

        private static readonly HashSet<string> KnownFilters = new HashSet<string>(StringComparer.Ordinal)
        {
            FilterAlwaysOn, FilterPercentage, FilterTargeting, FilterTimeWindow, FilterContextProperty, FilterBrowserFamily, FilterBrowserLanguage,
            "OS", "DeviceType", "CountryFamily", FilterUserClaims
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

            var lists = document.Lists ?? new List<CatalogList>();
            var listLookup = ValidateLists(lists, errors);
            var contexts = ValidateContexts(document.Contexts, errors);
            ValidateFeatures(document.Features, contexts, listLookup, errors);
            return new CatalogValidationResult(errors.Count == 0 && normalize ? document : null, errors);
        }

        private static Dictionary<string, CatalogList> ValidateLists(
            IList<CatalogList> lists,
            ICollection<CatalogValidationError> errors)
        {
            var result = new Dictionary<string, CatalogList>(StringComparer.OrdinalIgnoreCase);
            if (lists.Count > 500)
            {
                errors.Add(new CatalogValidationError("lists", "A catalog may contain at most 500 lists."));
            }

            for (var index = 0; index < lists.Count; index++)
            {
                var list = lists[index];
                var path = "lists[" + index.ToString(CultureInfo.InvariantCulture) + "]";
                if (list == null)
                {
                    errors.Add(new CatalogValidationError(path, "List must not be null."));
                    continue;
                }

                ValidateIdentifier(list.Key, path + ".key", "List key", errors);
                if (!string.IsNullOrEmpty(list.Key) && !result.TryAdd(list.Key, list))
                {
                    errors.Add(new CatalogValidationError(path + ".key", "List key duplicates an existing key."));
                }

                if (string.IsNullOrWhiteSpace(list.Name) || list.Name.Trim().Length > 200)
                {
                    errors.Add(new CatalogValidationError(path + PathName, "List name is required and must be at most 200 characters."));
                }

                if (list.Description == null || list.Description.Length > 8000)
                {
                    errors.Add(new CatalogValidationError(path + ".description", "Description must be plain text and at most 8,000 characters."));
                }

                ValidateListItems(list, path, errors);
            }

            return result;
        }

        private static void ValidateListItems(CatalogList list, string path, ICollection<CatalogValidationError> errors)
        {
            if (list.Items == null)
            {
                errors.Add(new CatalogValidationError(path + ".items", "Item collection must not be null."));
                return;
            }

            if (list.Items.Count > 10000)
            {
                errors.Add(new CatalogValidationError(path + ".items", "A list may contain at most 10,000 identifiers."));
            }

            var items = new HashSet<string>(StringComparer.Ordinal);
            for (var itemIndex = 0; itemIndex < list.Items.Count; itemIndex++)
            {
                var item = list.Items[itemIndex];
                var itemPath = path + ".items[" + itemIndex.ToString(CultureInfo.InvariantCulture) + "]";
                if (item == null || string.IsNullOrWhiteSpace(item) || item.Trim().Length > 256)
                {
                    errors.Add(new CatalogValidationError(itemPath, "List item must be 1-256 characters."));
                    continue;
                }

                if (!items.Add(item.Trim()))
                {
                    errors.Add(new CatalogValidationError(itemPath, "List item duplicates an existing identifier."));
                }
            }
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

                ValidateContextProperties(context, path, errors);
            }

            return result;
        }

        private static void ValidateContextProperties(CatalogContextSchema context, string path, ICollection<CatalogValidationError> errors)
        {
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

                ValidateContextName(property.Name, propertyPath + PathName, "Context property name", errors);
                if (!ContextTypes.Contains(property.Type ?? string.Empty))
                {
                    errors.Add(new CatalogValidationError(propertyPath + ".type", "Unsupported context property type."));
                }

                if (!string.IsNullOrEmpty(property.Name) && !propertyNames.Add(property.Name))
                {
                    errors.Add(new CatalogValidationError(propertyPath + PathName, "Context property duplicates an existing property."));
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

        private static void ValidateFeatures(
            IList<CatalogFeature> features,
            IReadOnlyDictionary<string, CatalogContextSchema> contexts,
            IReadOnlyDictionary<string, CatalogList> lists,
            ICollection<CatalogValidationError> errors)
        {
            var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < features.Count; index++)
            {
                ValidateFeature(features[index], "features[" + index.ToString(CultureInfo.InvariantCulture) + "]", keys, contexts, lists, errors);
            }
        }

        private static void ValidateFeature(
            CatalogFeature feature,
            string path,
            HashSet<string> keys,
            IReadOnlyDictionary<string, CatalogContextSchema> contexts,
            IReadOnlyDictionary<string, CatalogList> lists,
            ICollection<CatalogValidationError> errors)
        {
            if (feature == null)
            {
                errors.Add(new CatalogValidationError(path, "Feature must not be null."));
                return;
            }

            ValidateIdentifier(feature.Key, path + ".key", "Feature key", errors);
            if (!string.IsNullOrEmpty(feature.Key) && !keys.Add(feature.Key))
            {
                errors.Add(new CatalogValidationError(path + ".key", "Feature key duplicates an existing key."));
            }

            ValidateFeatureMetadata(feature, path, contexts, errors);
            ValidateTags(feature.Tags, path + ".tags", errors);
            ValidateFeatureRules(feature, contexts, lists, path, errors);
        }

        private static void ValidateFeatureMetadata(
            CatalogFeature feature,
            string path,
            IReadOnlyDictionary<string, CatalogContextSchema> contexts,
            ICollection<CatalogValidationError> errors)
        {
            if (string.IsNullOrWhiteSpace(feature.Name) || feature.Name.Trim().Length > 200)
            {
                errors.Add(new CatalogValidationError(path + PathName, "Feature name is required and must be at most 200 characters."));
            }

            if (feature.Category != null && feature.Category.Trim().Length > 200)
            {
                errors.Add(new CatalogValidationError(path + ".category", "Feature category must be at most 200 characters."));
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

            if (feature.ContextKind == null) return;
            ValidateContextName(feature.ContextKind, path + ".contextKind", "Context kind", errors);
            if (!contexts.ContainsKey(feature.ContextKind))
            {
                errors.Add(new CatalogValidationError(path + ".contextKind", "Context kind is not defined in this catalog."));
            }
        }

        private static void ValidateFeatureRules(
            CatalogFeature feature,
            IReadOnlyDictionary<string, CatalogContextSchema> contexts,
            IReadOnlyDictionary<string, CatalogList> lists,
            string path,
            ICollection<CatalogValidationError> errors)
        {
            if (feature.Rules == null)
            {
                errors.Add(new CatalogValidationError(path + ".rules", "Rule collection must not be null."));
                return;
            }

            if (feature.Enabled && feature.Rules.Count == 0)
            {
                errors.Add(new CatalogValidationError(path + ".rules", "At least one filter is required when the feature is enabled."));
            }

            for (var ruleIndex = 0; ruleIndex < feature.Rules.Count; ruleIndex++)
            {
                ValidateRule(feature, feature.Rules[ruleIndex], contexts, lists, path + ".rules[" + ruleIndex.ToString(CultureInfo.InvariantCulture) + "]", errors);
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
            IReadOnlyDictionary<string, CatalogList> lists,
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
                errors.Add(new CatalogValidationError(path + PathName, "Unknown filter."));
                return;
            }

            if (rule.Parameters == null)
            {
                errors.Add(new CatalogValidationError(path + PathParameters, "Rule parameters must not be null."));
                return;
            }

            if (rule.Name == FilterAlwaysOn)
            {
                ValidateExactParameters(rule.Parameters, Array.Empty<string>(), Array.Empty<string>(), path, errors);
            }
            else if (rule.Name == FilterPercentage)
            {
                ValidatePercentage(rule.Parameters, path, errors, ParamValue);
            }
            else if (rule.Name == FilterTargeting)
            {
                ValidateTargeting(rule.Parameters, lists, path, errors);
            }
            else if (rule.Name == FilterTimeWindow)
            {
                ValidateTimeWindow(rule.Parameters, path, errors);
            }
            else if (rule.Name == FilterContextProperty)
            {
                ValidateContextProperty(feature, rule.Parameters, contexts, path, errors);
            }
            else if (rule.Name == FilterUserClaims)
            {
                ValidateExactParameters(rule.Parameters, new[] { "Claim", ParamValue, FilterPercentage }, new[] { "Claim", ParamValue, FilterPercentage }, path, errors);
                ValidatePercentage(rule.Parameters, path, errors, FilterPercentage);
            }
            else
            {
                ValidateIndexedAndPercentage(rule.Parameters, IndexedPrefix(rule.Name ?? string.Empty), path, errors);
            }
        }

        private static string IndexedPrefix(string name)
        {
            if (name == FilterBrowserFamily) return "BrowserFamily:";
            if (name == FilterBrowserLanguage) return "BrowserLanguage:";
            if (name == "OS") return "OperatingSystem:";
            if (name == "DeviceType") return "DeviceType:";
            return "Country:";
        }

        private static readonly string[] TargetingListSlots =
        {
            "Audience.Users", "Audience.Groups", "Audience.Exclusion.Users", "Audience.Exclusion.Groups"
        };

        private static void ValidateTargeting(
            Dictionary<string, string> parameters,
            IReadOnlyDictionary<string, CatalogList> lists,
            string path,
            ICollection<CatalogValidationError> errors)
        {
            foreach (var key in parameters.Keys.Where(key =>
                key != "Audience.DefaultRolloutPercentage" && key != "IgnoreCase" &&
                Array.IndexOf(TargetingListSlots, key) < 0))
            {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + key, "Unknown Targeting parameter."));
            }

            foreach (var slot in TargetingListSlots)
            {
                if (!parameters.TryGetValue(slot, out var listKey) || string.IsNullOrWhiteSpace(listKey))
                {
                    continue;
                }

                if (!lists.ContainsKey(listKey.Trim()))
                {
                    errors.Add(new CatalogValidationError(path + PathParametersPrefix + slot, "Targeting list '" + listKey.Trim() + "' is not defined in this catalog."));
                }
            }

            ValidatePercentage(parameters, path, errors, "Audience.DefaultRolloutPercentage");
            if (parameters.TryGetValue("IgnoreCase", out var ignoreCase) && !bool.TryParse(ignoreCase, out _))
            {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + "IgnoreCase", "IgnoreCase must be true or false."));
            }
        }

        private static void ValidateTimeWindow(Dictionary<string, string> parameters, string path, ICollection<CatalogValidationError> errors)
        {
            ValidateExactParameters(parameters, new[] { "Start", "End" }, new string[0], path, errors);
            var hasStart = TryGetDate(parameters, "Start", path, errors, out var start);
            var hasEnd = TryGetDate(parameters, "End", path, errors, out var end);
            if (!hasStart && !hasEnd)
            {
                errors.Add(new CatalogValidationError(path + PathParameters, "TimeWindow must specify Start, End, or both."));
            }
            else if (hasStart && hasEnd && start >= end)
            {
                errors.Add(new CatalogValidationError(path + PathParameters, "TimeWindow Start must precede End."));
            }
        }

        private static void ValidateContextProperty(
            CatalogFeature feature,
            Dictionary<string, string> parameters,
            IReadOnlyDictionary<string, CatalogContextSchema> contexts,
            string path,
            ICollection<CatalogValidationError> errors)
        {
            ValidateExactParameters(parameters, new[] { ParamContextKind, ParamProperty, "Operator", ParamValue, "ValueType" }, new[] { ParamProperty, "Operator", ParamValue }, path, errors);
            var contextKind = GetRequiredParameter(parameters, ParamContextKind) ?? feature.ContextKind;
            if (string.IsNullOrWhiteSpace(contextKind) || !contexts.TryGetValue(contextKind, out var context))
            {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + ParamContextKind, "ContextKind must identify a defined context."));
                return;
            }

            if (feature.ContextKind == null || !string.Equals(feature.ContextKind, contextKind, StringComparison.OrdinalIgnoreCase))
            {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + ParamContextKind, "ContextProperty rule must match the feature context kind."));
            }

            var propertyName = GetRequiredParameter(parameters, ParamProperty);
            var property = context.Properties == null ? null : context.Properties.FirstOrDefault(candidate => string.Equals(candidate.Name, propertyName, StringComparison.OrdinalIgnoreCase));
            if (property == null)
            {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + ParamProperty, "Property must identify a property in the context schema."));
                return;
            }

            var valueType = NormalizeContextType(property.Type);
            var op = GetRequiredParameter(parameters, "Operator");
            if (!IsOperatorAllowed(property.Type, op))
            {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + "Operator", "Operator is not supported for this context property type."));
            }

            if (parameters.TryGetValue(ParamValue, out var value))
            {
                ValidateContextValue(valueType, value, op, path + PathParametersPrefix + ParamValue, errors);
            }
        }

        private static bool IsOperatorAllowed(string type, string? op)
        {
            op = op == null ? string.Empty : op.ToLowerInvariant();
            type = NormalizeContextType(type);
            if (op == "eq" || op == "neq") return true;
            if ((type == TypeNumber || type == "datetime") && (op == "gt" || op == "gte" || op == "lt" || op == "lte")) return true;
            if ((type == TypeString || type == TypeNumber || type == TypeStringArray) && op == "in") return true;
            return (type == TypeString || type == TypeStringArray) && op == "contains";
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
                return parts.Count > 0 && parts.All(part => IsSingleContextValueCompatible(part, normalizedType == TypeStringArray ? TypeString : normalizedType));
            }

            return IsSingleContextValueCompatible(value, normalizedType);
        }

        private static bool IsSingleContextValueCompatible(string value, string valueType)
        {
            switch (valueType)
            {
                case TypeNumber:
                    return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out _);
                case "boolean":
                    return bool.TryParse(value, out _);
                case "datetime":
                    return DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _) ||
                        DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out _);
                case TypeString:
                case TypeStringArray:
                    return value.Length > 0;
                default:
                    return false;
            }
        }

        private static void ValidateIndexedAndPercentage(Dictionary<string, string> parameters, string prefix, string path, ICollection<CatalogValidationError> errors)
        {
            foreach (var key in parameters.Keys.Where(key => key != FilterPercentage && !IsIndexedKey(key, prefix)))
            {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + key, "Unknown filter parameter."));
            }

            ValidateIndexedParameters(parameters, prefix, path, errors);
            ValidatePercentage(parameters, path, errors, FilterPercentage);
        }

        private static void ValidateExactParameters(Dictionary<string, string> parameters, IEnumerable<string> allowed, IEnumerable<string> required, string path, ICollection<CatalogValidationError> errors)
        {
            var allowedKeys = new HashSet<string>(allowed, StringComparer.Ordinal);
            foreach (var key in parameters.Keys.Where(key => !allowedKeys.Contains(key)))
            {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + key, "Unknown filter parameter."));
            }

            foreach (var key in required)
            {
                if (!parameters.TryGetValue(key, out var value) || value == null)
                {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + key, "Required filter parameter is missing."));
                }
            }
        }

        private static void ValidatePercentage(Dictionary<string, string> parameters, string path, ICollection<CatalogValidationError> errors, string key)
        {
            if (!parameters.TryGetValue(key, out var value) ||
                !decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var percentage) ||
                percentage < 0m || percentage > 100m)
            {
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + key, "Percentage must be between 0 and 100."));
            }
        }

        private static void ValidateIndexedParameters(Dictionary<string, string> parameters, string prefix, string path, ICollection<CatalogValidationError> errors)
        {
            var indexes = new List<int>();
            foreach (var key in parameters.Keys.Where(key => key.StartsWith(prefix, StringComparison.Ordinal)))
            {
                if (!int.TryParse(key.Substring(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var index) || index < 0)
                {
                    errors.Add(new CatalogValidationError(path + PathParametersPrefix + key, "Indexed parameter must use a non-negative integer index."));
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
                    errors.Add(new CatalogValidationError(path + PathParameters, "Indexed parameters must be contiguous and zero-based."));
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
                errors.Add(new CatalogValidationError(path + PathParametersPrefix + key, "Date must be ISO-8601 with an explicit offset."));
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
            return string.Equals(type, TypeStringArray, StringComparison.OrdinalIgnoreCase) ? TypeStringArray : (type ?? string.Empty).ToLowerInvariant();
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
                Environment = TrimOrEmpty(source.Environment),
                Features = source.Features == null ? null! : new List<CatalogFeature>(),
                Contexts = source.Contexts == null ? null! : new List<CatalogContextSchema>(),
                Lists = new List<CatalogList>()
            };

            if (source.Features != null)
            {
                foreach (var sourceFeature in source.Features)
                    document.Features.Add(CloneFeature(sourceFeature));
            }

            if (source.Contexts != null)
            {
                foreach (var sourceContext in source.Contexts)
                    document.Contexts.Add(CloneContext(sourceContext));
            }

            if (source.Lists != null)
            {
                foreach (var sourceList in source.Lists)
                    document.Lists.Add(CloneList(sourceList));
            }

            return document;
        }

        private static string TrimOrEmpty(string? value) => value == null ? string.Empty : value.Trim();

        private static CatalogFeature CloneFeature(CatalogFeature sourceFeature)
        {
            if (sourceFeature == null) return null!;
            return new CatalogFeature
            {
                Key = TrimOrEmpty(sourceFeature.Key),
                Name = TrimOrEmpty(sourceFeature.Name),
                Description = sourceFeature.Description == null ? null! : sourceFeature.Description.Trim(),
                Category = string.IsNullOrWhiteSpace(sourceFeature.Category) ? string.Empty : sourceFeature.Category.Trim(),
                Tags = NormalizeTags(sourceFeature.Tags),
                Enabled = sourceFeature.Enabled,
                RequirementType = sourceFeature.RequirementType,
                ContextKind = string.IsNullOrWhiteSpace(sourceFeature.ContextKind) ? null : sourceFeature.ContextKind.Trim(),
                ContextRequirementType = sourceFeature.ContextRequirementType,
                Rules = CloneRules(sourceFeature.Rules)
            };
        }

        private static CatalogContextSchema CloneContext(CatalogContextSchema sourceContext)
        {
            if (sourceContext == null) return null!;
            var context = new CatalogContextSchema
            {
                Kind = TrimOrEmpty(sourceContext.Kind),
                KeyPropertyName = TrimOrEmpty(sourceContext.KeyPropertyName),
                Properties = sourceContext.Properties == null ? null! : new List<CatalogContextProperty>()
            };
            if (sourceContext.Properties == null) return context;
            foreach (var sourceProperty in sourceContext.Properties)
                context.Properties.Add(CloneProperty(sourceProperty));
            return context;
        }

        private static CatalogContextProperty CloneProperty(CatalogContextProperty sourceProperty)
        {
            if (sourceProperty == null) return null!;
            return new CatalogContextProperty
            {
                Name = TrimOrEmpty(sourceProperty.Name),
                Type = sourceProperty.Type == null ? string.Empty : NormalizeContextType(sourceProperty.Type.Trim())
            };
        }

        private static CatalogList CloneList(CatalogList sourceList)
        {
            if (sourceList == null) return null!;
            return new CatalogList
            {
                Key = TrimOrEmpty(sourceList.Key),
                Name = TrimOrEmpty(sourceList.Name),
                Description = TrimOrEmpty(sourceList.Description),
                Items = NormalizeListItems(sourceList.Items)
            };
        }

        private static void StampContextPropertyRules(CatalogDocument document)
        {
            if (document.Features == null || document.Contexts == null) return;
            foreach (var feature in document.Features.Where(feature => feature != null && feature.Rules != null))
            {
                foreach (var rule in feature.Rules.Where(rule =>
                    rule != null &&
                    string.Equals(rule.Name, FilterContextProperty, StringComparison.OrdinalIgnoreCase) &&
                    rule.Parameters != null))
                {
                    StampContextPropertyRule(document, feature, rule);
                }
            }
        }

        private static void StampContextPropertyRule(CatalogDocument document, CatalogFeature feature, CatalogRule rule)
        {
            var kind = GetRequiredParameter(rule.Parameters, ParamContextKind) ?? feature.ContextKind;
            if (string.IsNullOrWhiteSpace(kind)) return;
            var context = document.Contexts.FirstOrDefault(candidate => candidate != null && string.Equals(candidate.Kind, kind, StringComparison.OrdinalIgnoreCase));
            if (context == null || context.Properties == null) return;
            var propertyName = GetRequiredParameter(rule.Parameters, ParamProperty);
            var property = context.Properties.FirstOrDefault(candidate => candidate != null && string.Equals(candidate.Name, propertyName, StringComparison.OrdinalIgnoreCase));
            if (property == null) return;

            rule.Parameters[ParamContextKind] = context.Kind;
            rule.Parameters[ParamProperty] = property.Name;
            rule.Parameters["ValueType"] = NormalizeContextType(property.Type);
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

        private static List<string> NormalizeListItems(List<string>? items)
        {
            if (items == null) return null!;
            return items.Where(item => !string.IsNullOrWhiteSpace(item)).Select(item => item.Trim()).ToList();
        }

        private static List<CatalogRule> CloneRules(List<CatalogRule>? rules)
        {
            if (rules == null) return null!;
            return rules.Select(CloneRule).ToList();
        }

        private static CatalogRule CloneRule(CatalogRule rule)
        {
            if (rule == null) return null!;
            return new CatalogRule
            {
                Name = TrimOrEmpty(rule.Name),
                Parameters = rule.Parameters == null ? null! : new Dictionary<string, string>(rule.Parameters, StringComparer.Ordinal)
            };
        }
    }
}
