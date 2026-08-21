using System;
using System.Collections.Generic;
using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement.Configuration
{
    /// <summary>
    /// Configures schema properties and optional attribute overrides for
    /// <see cref="EntityContextServiceCollectionExtensions.AddTogglyEntityContext{T}"/>.
    /// </summary>
    public sealed class EntityContextBuilder<T>
    {
        private readonly string _kind;
        private readonly Func<T, string> _keySelector;
        private readonly List<EntityContextPropertyRegistration> _properties = new List<EntityContextPropertyRegistration>();
        private Func<T, IReadOnlyDictionary<string, object?>>? _attributeSelector;
        private string _keyPropertyName = "Id";

        internal EntityContextBuilder(string kind, Func<T, string> keySelector)
        {
            _kind = kind;
            _keySelector = keySelector;
        }

        /// <summary>
        /// Names the catalog key property (defaults to Id).
        /// </summary>
        public EntityContextBuilder<T> KeyProperty(string name)
        {
            _keyPropertyName = name;
            return this;
        }

        /// <summary>
        /// Registers a schema property discovered from the entity type.
        /// </summary>
        public EntityContextBuilder<T> Property(string name, string type)
        {
            _properties.Add(new EntityContextPropertyRegistration(name, type));
            return this;
        }

        /// <summary>
        /// Overrides attribute mapping for evaluation (option C explicit map).
        /// </summary>
        public EntityContextBuilder<T> MapAttributes(Func<T, IReadOnlyDictionary<string, object?>> selector)
        {
            _attributeSelector = selector;
            return this;
        }

        internal EntityContextRegistration Build()
        {
            Func<object, string> keySelector = instance => _keySelector((T)instance);
            Func<object, IReadOnlyDictionary<string, object?>>? attributeSelector = null;
            if (_attributeSelector != null)
            {
                var selector = _attributeSelector;
                attributeSelector = instance => selector((T)instance);
            }

            return new EntityContextRegistration(
                typeof(T),
                _kind,
                _keyPropertyName,
                keySelector,
                attributeSelector,
                _properties);
        }
    }
}
