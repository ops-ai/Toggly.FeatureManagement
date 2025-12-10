using Microsoft.Extensions.DependencyInjection;
using NSwag.Generation.AspNetCore;
using System;
using Toggly.FeatureManagement.NSwag;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using NSwag.AspNetCore;
using NSwag.AspNetCore.Middlewares;
using System.Reflection;
using Microsoft.AspNetCore.Builder;
using System.Collections.Generic;

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
        
        /// <summary>Adds the OpenAPI/Swagger generator that uses the ASP.NET Core API Explorer 
        /// (default route defined in document: /swagger/v1/swagger.json).</summary>
        /// <remarks>Registers multiple routes/documents if the settings.Path contains a '{documentName}' placeholder.</remarks>
        /// <param name="app">The app.</param>
        /// <param name="configure">Configure additional settings.</param>
        public static IApplicationBuilder UseFeatureAwareOpenApi(this IApplicationBuilder app, Action<OpenApiDocumentMiddlewareSettings> configure = null)
        {
            var settings = configure == null ? app.ApplicationServices.GetService<IOptions<OpenApiDocumentMiddlewareSettings>>()?.Value : null ?? new OpenApiDocumentMiddlewareSettings();
            configure?.Invoke(settings);

            if (settings.Path.Contains("{documentName}"))
            {
                var documents = app.ApplicationServices.GetRequiredService<IEnumerable<OpenApiDocumentRegistration>>();
                foreach (var document in documents)
                {
                    app = app.UseMiddleware<Toggly.FeatureManagement.NSwag.OpenApiDocumentMiddleware>(document.DocumentName, settings.Path.Replace("{documentName}", document.DocumentName), settings);
                }

                return app;
            }
            else
            {
                return app.UseMiddleware<Toggly.FeatureManagement.NSwag.OpenApiDocumentMiddleware>(settings.DocumentName, settings.Path, settings);
            }
        }
    }
}