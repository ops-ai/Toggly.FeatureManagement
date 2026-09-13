using Microsoft.Extensions.Options;

namespace Toggly.FeatureManagement.Embedded;

public sealed class TogglyEmbeddedOptions
{
    public string? CatalogName { get; set; }
    public TimeSpan PollInterval { get; set; } = TimeSpan.FromSeconds(5);
    public TimeSpan InitialLoadTimeout { get; set; } = TimeSpan.FromSeconds(5);
    public long MaxCatalogBytes { get; set; } = 10 * 1024 * 1024;
    public bool ReadOnly { get; set; }
}

internal sealed class TogglyEmbeddedOptionsValidator : IValidateOptions<TogglyEmbeddedOptions>
{
    public ValidateOptionsResult Validate(string? name, TogglyEmbeddedOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.CatalogName)) return ValidateOptionsResult.Fail("Toggly embedded CatalogName must resolve to a non-empty value.");
        if (options.PollInterval <= TimeSpan.Zero) return ValidateOptionsResult.Fail("Toggly embedded PollInterval must be positive.");
        if (options.InitialLoadTimeout <= TimeSpan.Zero) return ValidateOptionsResult.Fail("Toggly embedded InitialLoadTimeout must be positive.");
        if (options.MaxCatalogBytes <= 0) return ValidateOptionsResult.Fail("Toggly embedded MaxCatalogBytes must be positive.");
        return ValidateOptionsResult.Success;
    }
}
