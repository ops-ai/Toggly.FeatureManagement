using Microsoft.Extensions.DependencyInjection;
using NSwag.Generation.AspNetCore;
using System;
using Toggly.FeatureManagement.NSwag;

namespace Toggly.FeatureManagement.NSwag.Configuration
{
    /// <summary>
    /// Extension methods for configuring NSwag with feature gate filtering.
    /// </summary>
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Adds feature flag-based operation filtering to NSwag OpenAPI document generation.
        /// Operations with disabled feature flags will be excluded from Swagger documentation.
        /// </summary>
        /// <param name="settings">The NSwag OpenAPI document generator settings.</param>
        /// <param name="serviceProvider">The service provider to resolve IFeatureManager.</param>
        /// <returns>The settings instance for method chaining.</returns>
        public static AspNetCoreOpenApiDocumentGeneratorSettings AddFeatureGateFiltering(
            this AspNetCoreOpenApiDocumentGeneratorSettings settings,
            IServiceProvider serviceProvider)
        {
            if (settings == null)
                throw new ArgumentNullException(nameof(settings));
            if (serviceProvider == null)
                throw new ArgumentNullException(nameof(serviceProvider));

            settings.OperationProcessors.Add(new FeatureGateOperationProcessor(serviceProvider));
            return settings;
        }
    }
}
