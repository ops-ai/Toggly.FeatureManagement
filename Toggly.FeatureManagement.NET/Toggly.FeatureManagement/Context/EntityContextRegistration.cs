using System;
using System.Collections.Generic;

namespace Toggly.FeatureManagement.Context
{
    internal sealed class EntityContextRegistration
    {
        public EntityContextRegistration(
            Type clrType,
            string kind,
            string keyPropertyName,
            Func<object, string> keySelector,
            Func<object, IReadOnlyDictionary<string, object?>>? attributeSelector,
            IReadOnlyList<EntityContextPropertyRegistration> schemaProperties)
        {
            ClrType = clrType;
            Kind = kind;
            KeyPropertyName = keyPropertyName;
            KeySelector = keySelector;
            AttributeSelector = attributeSelector;
            SchemaProperties = schemaProperties;
        }

        public Type ClrType { get; }

        public string Kind { get; }

        public string KeyPropertyName { get; }

        public Func<object, string> KeySelector { get; }

        public Func<object, IReadOnlyDictionary<string, object?>>? AttributeSelector { get; }

        public IReadOnlyList<EntityContextPropertyRegistration> SchemaProperties { get; }
    }

    internal sealed class EntityContextPropertyRegistration
    {
        public EntityContextPropertyRegistration(string name, string type)
        {
            Name = name;
            Type = type;
        }

        public string Name { get; }

        public string Type { get; }
    }
}
