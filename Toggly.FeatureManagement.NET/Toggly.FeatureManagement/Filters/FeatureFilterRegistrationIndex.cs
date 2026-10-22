#nullable enable

using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;

namespace Toggly.FeatureManagement.Filters
{
    /// <summary>
    /// Resolves configuration names for registered <see cref="IFeatureFilter"/> types.
    /// </summary>
    public sealed class FeatureFilterRegistrationIndex
    {
        /// <summary>
        /// Configuration names for filters registered by Microsoft.FeatureManagement via factory descriptors.
        /// </summary>
        internal static readonly string[] FactoryRegisteredConfigurationNames =
        {
            "Microsoft.TimeWindow"
        };

        private readonly HashSet<string> _registeredNames;

        public FeatureFilterRegistrationIndex(IEnumerable<string> registeredNames)
        {
            _registeredNames = new HashSet<string>(registeredNames, StringComparer.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Builds an index from service descriptors (for tests before building a provider).
        /// </summary>
        public static FeatureFilterRegistrationIndex FromServiceCollection(IServiceCollection services)
        {
            var names = services
                .Where(d => d.ServiceType == typeof(IFeatureFilterMetadata) && d.ImplementationType != null)
                .Select(d => ResolveConfigurationName(d.ImplementationType!))
                .Where(name => !string.IsNullOrEmpty(name))
                .ToList();

            if (services.Any(d =>
                    d.ServiceType == typeof(IFeatureFilterMetadata) && d.ImplementationFactory != null))
            {
                names.AddRange(FactoryRegisteredConfigurationNames);
            }

            return new FeatureFilterRegistrationIndex(names);
        }

        /// <summary>
        /// True when a filter configuration name has a matching registration.
        /// </summary>
        public bool IsRegistered(string? configurationName) =>
            !string.IsNullOrEmpty(configurationName) && _registeredNames.Contains(configurationName);

        internal IReadOnlyCollection<string> RegisteredNames => _registeredNames;

        internal static string ResolveConfigurationName(Type implementationType)
        {
            var alias = (FilterAliasAttribute?)Attribute.GetCustomAttribute(
                implementationType,
                typeof(FilterAliasAttribute));
            if (!string.IsNullOrEmpty(alias?.Alias))
                return alias.Alias;

            var name = implementationType.Name;
            if (name.EndsWith("Filter", StringComparison.Ordinal))
                name = name[..^"Filter".Length];

            return name;
        }
    }
}
