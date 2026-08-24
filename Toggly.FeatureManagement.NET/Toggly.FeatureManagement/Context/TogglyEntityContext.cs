using System;
using System.Collections.Generic;

namespace Toggly.FeatureManagement.Context
{
    /// <summary>
    /// Canonical entity instance passed into feature evaluation (Order, Product, etc.).
    /// </summary>
    public sealed class TogglyEntityContext
    {
        public TogglyEntityContext(string kind, string key, IReadOnlyDictionary<string, object?> attributes)
        {
            Kind = kind;
            Key = key;
            var map = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            if (attributes != null)
            {
                foreach (var pair in attributes)
                    map[pair.Key] = pair.Value;
            }
            Attributes = map;
        }

        public string Kind { get; }

        public string Key { get; }

        public IReadOnlyDictionary<string, object?> Attributes { get; }
    }
}
