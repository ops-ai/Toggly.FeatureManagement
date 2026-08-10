using Xunit;

namespace Toggly.FeatureManagement.Tests;

/// <summary>
/// Serializes tests that construct <see cref="TogglyFeatureProvider"/> and mutate
/// <see cref="TogglyFeatureProvider.WebSocketClientFactoryOverride"/> so xUnit cannot
/// run them in parallel across classes.
/// </summary>
[CollectionDefinition(Name)]
public class TogglyFeatureProviderCollection : ICollectionFixture<object>
{
    public const string Name = "TogglyFeatureProvider";
}
