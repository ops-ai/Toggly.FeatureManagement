using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.FeatureManagement;
using System;
using System.Linq;

namespace Toggly.FeatureManagement.Helpers
{
    public static class ServiceCollectionExtensions
    {
        public static void Decorate<TInterface, TDecorator>(this IServiceCollection services)
          where TInterface : class
          where TDecorator : class, TInterface
        {
            // grab the existing registration
            var wrappedDescriptor = services.FirstOrDefault(
              s => s.ServiceType == typeof(TInterface));

            // check it's valid
            if (wrappedDescriptor == null)
                throw new InvalidOperationException($"{typeof(TInterface).Name} is not registered");

            // create the object factory for our decorator type,
            // specifying that we will supply TInterface explicitly
            var objectFactory = ActivatorUtilities.CreateFactory(
              typeof(TDecorator),
              new[] { typeof(TInterface) });

            // replace the existing registration with one
            // that passes an instance of the existing registration
            // to the object factory for the decorator
            services.Replace(ServiceDescriptor.Describe(
              typeof(TInterface),
              s => (TInterface)objectFactory(s, new[] { s.CreateInstance(wrappedDescriptor) }),
              wrappedDescriptor.Lifetime)
            );
        }

        private static object CreateInstance(this IServiceProvider services, ServiceDescriptor descriptor)
        {
            if (descriptor.ImplementationInstance != null)
                return descriptor.ImplementationInstance;

            if (descriptor.ImplementationFactory != null)
                return descriptor.ImplementationFactory(services);

            return ActivatorUtilities.GetServiceOrCreateInstance(services, descriptor.ImplementationType!);
        }

        public static void DecorateForFeature<TInterface, TDecorator>(this IServiceCollection services, string featureName)
          where TInterface : class
          where TDecorator : class, TInterface
        {
            // grab the existing registration
            var wrappedDescriptor = services.FirstOrDefault(
              s => s.ServiceType == typeof(TInterface));

            // check it's valid
            if (wrappedDescriptor == null)
                throw new InvalidOperationException($"{typeof(TInterface).Name} is not registered");

            var objectFactory = ActivatorUtilities.CreateFactory(
              typeof(TDecorator),
              new[] { typeof(TInterface) });

            // replace the existing registration with one
            // that passes an instance of the existing registration
            // to the object factory for the decorator
            services.Replace(ServiceDescriptor.Describe(
              typeof(TInterface),
              s => s.GetRequiredService<IFeatureManager>().IsEnabledAsync(featureName).ConfigureAwait(false).GetAwaiter().GetResult() ?
                        (TInterface)objectFactory(s, new[] { s.CreateInstance(wrappedDescriptor) }) :
                        ActivatorUtilities.CreateInstance(s, wrappedDescriptor.ImplementationType!),
              wrappedDescriptor.Lifetime)
            );
        }

        public static void AddTransientForFeature<TInterface, TImplementation>(this IServiceCollection services, string featureName)
             where TInterface : class
             where TImplementation : class, TInterface
        {
            // grab the existing registration if it exists
            var oldDescriptor = services.FirstOrDefault(s => s.ServiceType == typeof(TInterface));
            if (oldDescriptor == null)
                services.Add(ServiceDescriptor.Describe(
                  typeof(TInterface),
                  serviceProvider => serviceProvider.GetRequiredService<IFeatureManager>().IsEnabledAsync(featureName).ConfigureAwait(false).GetAwaiter().GetResult() ?
                        ActivatorUtilities.CreateInstance(serviceProvider, typeof(TImplementation)) :
                        throw new NotImplementedException("Feature {featureName} is not enabled, and no other instance of the service is registered"),
                  ServiceLifetime.Transient)
                );
            else
                services.Replace(ServiceDescriptor.Describe(
                  typeof(TInterface),
                  serviceProvider => serviceProvider.GetRequiredService<IFeatureManager>().IsEnabledAsync(featureName).ConfigureAwait(false).GetAwaiter().GetResult() ?
                        ActivatorUtilities.CreateInstance(serviceProvider, typeof(TImplementation)) :
                        ActivatorUtilities.CreateInstance(serviceProvider, oldDescriptor.ImplementationType!),
                  ServiceLifetime.Transient)
                );
        }

        public static void AddScopedForFeature<TInterface, TImplementation>(this IServiceCollection services, string featureName)
             where TInterface : class
             where TImplementation : class, TInterface
        {
            // grab the existing registration if it exists
            var oldDescriptor = services.FirstOrDefault(s => s.ServiceType == typeof(TInterface));
            if (oldDescriptor == null)
                services.Add(ServiceDescriptor.Describe(
                  typeof(TInterface),
                  serviceProvider => serviceProvider.GetRequiredService<IFeatureManager>().IsEnabledAsync(featureName).ConfigureAwait(false).GetAwaiter().GetResult() ?
                        ActivatorUtilities.CreateInstance(serviceProvider, typeof(TImplementation)) :
                        throw new NotImplementedException("Feature {featureName} is not enabled, and no other instance of the service is registered"),
                  ServiceLifetime.Scoped)
                );
            else
                services.Replace(ServiceDescriptor.Describe(
                  typeof(TInterface),
                  serviceProvider => serviceProvider.GetRequiredService<IFeatureManager>().IsEnabledAsync(featureName).ConfigureAwait(false).GetAwaiter().GetResult() ?
                        ActivatorUtilities.CreateInstance(serviceProvider, typeof(TImplementation)) :
                        ActivatorUtilities.CreateInstance(serviceProvider, oldDescriptor.ImplementationType!),
                  ServiceLifetime.Scoped)
                );
        }
    }
}
