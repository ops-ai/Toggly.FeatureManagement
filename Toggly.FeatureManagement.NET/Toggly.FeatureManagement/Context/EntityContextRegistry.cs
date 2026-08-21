using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace Toggly.FeatureManagement.Context
{
    internal sealed class EntityContextRegistry
    {
        private readonly ConcurrentDictionary<Type, EntityContextRegistration> _byType = new ConcurrentDictionary<Type, EntityContextRegistration>();

        public void Register(EntityContextRegistration registration)
        {
            _byType[registration.ClrType] = registration;
        }

        public bool TryGet(Type type, out EntityContextRegistration? registration)
        {
            if (_byType.TryGetValue(type, out registration))
                return true;

            registration = null;
            return false;
        }

        public IReadOnlyList<EntityContextRegistration> GetAll() => _byType.Values.ToList();

        public static IReadOnlyDictionary<string, object?> BuildSchemaAttributes(
            object instance,
            EntityContextRegistration registration)
        {
            if (registration.AttributeSelector != null)
                return registration.AttributeSelector(instance);

            var values = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            var type = instance.GetType();

            foreach (var property in registration.SchemaProperties)
            {
                var member = type.GetProperty(property.Name, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (member == null)
                    continue;

                values[property.Name] = member.GetValue(instance);
            }

            return values;
        }
    }
}
