using Microsoft.Extensions.DependencyInjection;
using System;
using System.Linq;

namespace Toggly.FeatureManagement.Configuration
{
    internal enum TogglyRuntimeMode { Cloud, Embedded }

    internal sealed class TogglyRuntimeModeRegistration
    {
        public TogglyRuntimeModeRegistration(TogglyRuntimeMode mode) => Mode = mode;
        public TogglyRuntimeMode Mode { get; }
    }

    internal static class TogglyRuntimeModeExtensions
    {
        internal static bool EnsureTogglyRuntimeMode(this IServiceCollection services, TogglyRuntimeMode mode)
        {
            var existing = services.Where(d => d.ServiceType == typeof(TogglyRuntimeModeRegistration))
                .Select(d => d.ImplementationInstance as TogglyRuntimeModeRegistration).FirstOrDefault(r => r != null);
            if (existing == null)
            {
                services.AddSingleton(new TogglyRuntimeModeRegistration(mode));
                return true;
            }
            if (existing.Mode != mode)
            {
                var oldMode = existing.Mode == TogglyRuntimeMode.Cloud ? "cloud" : "embedded";
                var newMode = mode == TogglyRuntimeMode.Cloud ? "cloud" : "embedded";
                throw new InvalidOperationException($"Toggly {oldMode} and {newMode} runtimes cannot be registered together.");
            }
            return false;
        }
    }
}
