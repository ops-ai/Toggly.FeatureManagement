using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Tests.TestHelpers;

/// <summary>
/// Factory for creating test data instances.
/// </summary>
public static class TestDataFactory
{
    /// <summary>
    /// Creates a TogglySettings instance with default test values.
    /// </summary>
    public static TogglySettings CreateSettings(
        string appKey = "test-app-key",
        string environment = "Test",
        string? baseUrl = null,
        string? definitionsBaseUrl = null,
        bool useSignedDefinitions = false)
    {
        return new TogglySettings
        {
            AppKey = appKey,
            Environment = environment,
            BaseUrl = baseUrl,
            DefinitionsBaseUrl = definitionsBaseUrl,
            UseSignedDefinitions = useSignedDefinitions,
            UndefinedEnabledOnDevelopment = false
        };
    }

    /// <summary>
    /// Creates a simple feature definition with AlwaysOn filter.
    /// </summary>
    public static FeatureDefinitionModel CreateSimpleFeature(
        string featureKey = "test-feature",
        bool secured = false)
    {
        return new FeatureDefinitionModel
        {
            FeatureKey = featureKey,
            SecuredFeature = secured,
            RequirementType = RequirementType.Any,
            Filters = new List<FeatureFilter>
            {
                new AlwaysOnFilter { Name = "AlwaysOn" }
            }
        };
    }

    /// <summary>
    /// Creates a feature definition with a percentage filter.
    /// </summary>
    public static FeatureDefinitionModel CreatePercentageFeature(
        string featureKey,
        int percentage,
        bool secured = false)
    {
        return new FeatureDefinitionModel
        {
            FeatureKey = featureKey,
            SecuredFeature = secured,
            RequirementType = RequirementType.Any,
            Filters = new List<FeatureFilter>
            {
                new FeatureFilter
                {
                    Name = "Percentage",
                    Parameters = new Dictionary<string, string> { { "Value", percentage.ToString() } }
                }
            }
        };
    }

    /// <summary>
    /// Creates a feature definition with metrics.
    /// </summary>
    public static FeatureDefinitionModel CreateFeatureWithMetrics(
        string featureKey,
        params string[] metrics)
    {
        return new FeatureDefinitionModel
        {
            FeatureKey = featureKey,
            SecuredFeature = false,
            RequirementType = RequirementType.Any,
            Metrics = metrics.ToList(),
            Filters = new List<FeatureFilter>
            {
                new AlwaysOnFilter { Name = "AlwaysOn" }
            }
        };
    }

    /// <summary>
    /// Creates a complex feature definition.
    /// </summary>
    public static FeatureDefinitionModel CreateComplexFeature(
        string featureKey,
        RequirementType requirementType,
        bool secured,
        List<FeatureFilter> filters,
        List<string>? metrics = null)
    {
        return new FeatureDefinitionModel
        {
            FeatureKey = featureKey,
            SecuredFeature = secured,
            RequirementType = requirementType,
            Metrics = metrics,
            Filters = filters
        };
    }

    /// <summary>
    /// Creates a list of test feature definitions.
    /// </summary>
    public static List<FeatureDefinitionModel> CreateFeatureList(int count = 3)
    {
        var features = new List<FeatureDefinitionModel>();
        for (int i = 0; i < count; i++)
        {
            features.Add(CreateSimpleFeature($"feature-{i}"));
        }
        return features;
    }

    /// <summary>
    /// Creates a JsonWebKeySet for testing.
    /// </summary>
    public static JsonWebKeySet CreateTestJwks()
    {
        return new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new JsonWebKey
                {
                    Kid = "test-key-id",
                    Kty = "EC",
                    Crv = "P-256",
                    X = "test-x-value",
                    Y = "test-y-value",
                    Use = "sig",
                    Alg = "ES256"
                }
            }
        };
    }

    /// <summary>
    /// Creates a FeatureFilter with the specified name and parameters.
    /// </summary>
    public static FeatureFilter CreateFilter(
        string name,
        Dictionary<string, string>? parameters = null)
    {
        return new FeatureFilter
        {
            Name = name,
            Parameters = parameters
        };
    }
}
