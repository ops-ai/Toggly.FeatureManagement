using Microsoft.Extensions.Logging;
using System;
using System.Collections.Concurrent;
using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement
{
    internal sealed class TogglyEntityContextResolver : ITogglyEntityContextResolver
    {
        private readonly EntityContextRegistry _registry;
        private readonly ILogger<TogglyEntityContextResolver> _logger;
        private readonly ConcurrentDictionary<Type, bool> _loggedMissing = new ConcurrentDictionary<Type, bool>();

        public TogglyEntityContextResolver(EntityContextRegistry registry, ILogger<TogglyEntityContextResolver> logger)
        {
            _registry = registry;
            _logger = logger;
        }

        public bool TryResolve<T>(T instance, out TogglyEntityContext? context)
        {
            context = null;
            if (instance == null)
                return false;

            if (instance is TogglyEvaluationContext evaluationContext)
            {
                context = evaluationContext.Entity;
                return context != null;
            }

            if (instance is TogglyEntityContext entityContext)
            {
                context = entityContext;
                return true;
            }

            var type = instance.GetType();
            if (!_registry.TryGet(type, out var registration) || registration == null)
            {
                if (_loggedMissing.TryAdd(type, true))
                {
                    _logger.LogWarning(
                        "No Toggly entity context registration for type {ClrType}. Entity rules fail closed.",
                        type.FullName);
                }

                return false;
            }

            var key = registration.KeySelector(instance) ?? string.Empty;
            var attributes = EntityContextRegistry.BuildSchemaAttributes(instance, registration);
            context = new TogglyEntityContext(registration.Kind, key, attributes);
            return true;
        }
    }
}
