using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using System;
using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement.Configuration
{
    /// <summary>
    /// Registers entity context kinds for server-side evaluation and optional startup catalog sync.
    /// </summary>
    public static class EntityContextServiceCollectionExtensions
    {
        /// <summary>
        /// Registers a domain type as an entity context kind (Order, Product, etc.).
        /// </summary>
        /// <typeparam name="T">Domain type rendered on pages or passed to <see cref="Microsoft.FeatureManagement.IFeatureManager.IsEnabledAsync{TContext}(string, TContext)"/>.</typeparam>
        /// <param name="services">Application services.</param>
        /// <param name="kind">Catalog kind name.</param>
        /// <param name="keySelector">Stable instance key (Id, OrderNumber, etc.).</param>
        /// <param name="configure">Optional schema properties and attribute override.</param>
        public static IServiceCollection AddTogglyEntityContext<T>(
            this IServiceCollection services,
            string kind,
            Func<T, string> keySelector,
            Action<EntityContextBuilder<T>>? configure = null)
        {
            if (string.IsNullOrWhiteSpace(kind))
                throw new ArgumentException("Kind is required.", nameof(kind));
            if (keySelector == null)
                throw new ArgumentNullException(nameof(keySelector));

            services.TryAddSingleton<EntityContextRegistry>(CreateRegistry);
            services.TryAddSingleton<ITogglyEntityContextResolver, TogglyEntityContextResolver>();

            var builder = new EntityContextBuilder<T>(kind, keySelector);
            configure?.Invoke(builder);

            services.AddOptions<EntityContextRegistryOptions>()
                .Configure(options => options.Registrations.Add(builder.Build()));

            return services;
        }

        internal static EntityContextRegistry CreateRegistry(IServiceProvider serviceProvider)
        {
            var options = serviceProvider.GetRequiredService<IOptions<EntityContextRegistryOptions>>().Value;
            var registry = new EntityContextRegistry();
            foreach (var registration in options.Registrations)
                registry.Register(registration);
            return registry;
        }
    }
}
