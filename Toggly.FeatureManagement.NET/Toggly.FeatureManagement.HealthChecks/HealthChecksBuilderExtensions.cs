using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using System;
using System.Collections.Generic;

namespace Toggly.FeatureManagement.HealthChecks
{
    /// <summary>
    /// Extension methods for adding Toggly health checks.
    /// </summary>
    public static class HealthChecksBuilderExtensions
    {
        /// <summary>
        /// Adds a health check for the Toggly Feature Management SDK.
        /// </summary>
        /// <param name="builder">The health checks builder.</param>
        /// <param name="name">The name of the health check. Default: "toggly".</param>
        /// <param name="failureStatus">The health status to report when the check fails. Default: null (uses context default).</param>
        /// <param name="tags">Tags to associate with the health check.</param>
        /// <param name="configure">Optional configuration action for health check options.</param>
        /// <returns>The health checks builder for chaining.</returns>
        public static IHealthChecksBuilder AddTogglyHealthCheck(
            this IHealthChecksBuilder builder,
            string name = "toggly",
            HealthStatus? failureStatus = null,
            IEnumerable<string>? tags = null,
            Action<TogglyHealthCheckOptions>? configure = null)
        {
            // Configure options
            if (configure != null)
            {
                builder.Services.Configure(configure);
            }
            else
            {
                // Ensure options are registered even if not configured
                builder.Services.Configure<TogglyHealthCheckOptions>(_ => { });
            }

            // Register the health check
            builder.Add(new HealthCheckRegistration(
                name,
                sp => ActivatorUtilities.CreateInstance<TogglyHealthCheck>(sp),
                failureStatus,
                tags));

            return builder;
        }

        /// <summary>
        /// Adds a health check for the Toggly Feature Management SDK with required features.
        /// </summary>
        /// <param name="builder">The health checks builder.</param>
        /// <param name="requiredFeatures">Features that must be enabled for the service to be healthy.</param>
        /// <param name="name">The name of the health check. Default: "toggly".</param>
        /// <param name="failureStatus">The health status to report when the check fails.</param>
        /// <param name="tags">Tags to associate with the health check.</param>
        /// <returns>The health checks builder for chaining.</returns>
        public static IHealthChecksBuilder AddTogglyHealthCheck(
            this IHealthChecksBuilder builder,
            IEnumerable<string> requiredFeatures,
            string name = "toggly",
            HealthStatus? failureStatus = null,
            IEnumerable<string>? tags = null)
        {
            return builder.AddTogglyHealthCheck(
                name,
                failureStatus,
                tags,
                options => options.RequiredFeatures = requiredFeatures);
        }
    }
}
