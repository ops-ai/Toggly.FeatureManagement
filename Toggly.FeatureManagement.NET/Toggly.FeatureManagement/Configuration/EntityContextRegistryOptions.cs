using System.Collections.Generic;
using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement.Configuration
{
    internal sealed class EntityContextRegistryOptions
    {
        public List<EntityContextRegistration> Registrations { get; } = new List<EntityContextRegistration>();
    }
}
