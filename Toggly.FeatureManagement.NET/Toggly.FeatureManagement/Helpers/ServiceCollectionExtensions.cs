using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.FeatureManagement;
using System;
using System.Linq;

namespace Toggly.FeatureManagement.Helpers
{
    /// <summary>
    /// Extension methods for conditional registration and decorator patterns with Microsoft Feature Management.
    /// </summary>
    public static class ServiceCollectionExtensions
    {
        /// <summary>
        /// Replaces the existing registration for <typeparamref name="TInterface"/> with <typeparamref name="TDecorator"/>,
        /// which receives the previous implementation as a constructor dependency.
        /// </summary>
        /// <typeparam name="TInterface">Service abstraction to wrap.</typeparam>
        /// <typeparam name="TDecorator">Decorator type; must implement <typeparamref name="TInterface"/>.</typeparam>
        /// <param name="services">The application service collection.</param>
        /// <exception cref="InvalidOperationException"><typeparamref name="TInterface"/> is not registered.</exception>
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

            return descriptor.ImplementationType != null ? ActivatorUtilities.GetServiceOrCreateInstance(services, descriptor.ImplementationType) : descriptor.ImplementationFactory != null ? descriptor.ImplementationFactory(services) : throw new InvalidOperationException("Unable to create instance");
        }

        /// <summary>
        /// Like <see cref="DecorateForFeature{TInterface, TDecorator}(IServiceCollection, string)"/>, but resolves the feature name from an enum value.
        /// </summary>
        /// <typeparam name="TInterface">Service abstraction to wrap.</typeparam>
        /// <typeparam name="TDecorator">Decorator type; must implement <typeparamref name="TInterface"/>.</typeparam>
        /// <param name="services">The application service collection.</param>
        /// <param name="featureName">Enum value whose name is used as the feature flag key.</param>
        /// <exception cref="ArgumentException"><paramref name="featureName"/> is not an enum or has no name.</exception>
        public static void DecorateForFeature<TInterface, TDecorator>(this IServiceCollection services, object featureName)
          where TInterface : class
          where TDecorator : class, TInterface
        {
            var type = featureName.GetType();

            if (!type.IsEnum)
                throw new ArgumentException("The provided feature name must be an enum.", nameof(featureName));

            var name = Enum.GetName(featureName.GetType(), featureName);
            if (string.IsNullOrEmpty(name))
                throw new ArgumentException("The enum value has no registered name.", nameof(featureName));

            DecorateForFeature<TInterface, TDecorator>(services, name);
        }

        /// <summary>
        /// Registers <typeparamref name="TDecorator"/> when the given feature flag is enabled; otherwise keeps or falls back to the prior <typeparamref name="TInterface"/> registration.
        /// </summary>
        /// <typeparam name="TInterface">Service abstraction to wrap.</typeparam>
        /// <typeparam name="TDecorator">Decorator type; must implement <typeparamref name="TInterface"/>.</typeparam>
        /// <param name="services">The application service collection.</param>
        /// <param name="featureName">Feature flag name evaluated via <see cref="IFeatureManager"/>.</param>
        /// <exception cref="InvalidOperationException"><typeparamref name="TInterface"/> is not registered.</exception>
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
                        wrappedDescriptor.ImplementationFactory != null ? wrappedDescriptor.ImplementationFactory(s) : wrappedDescriptor.ImplementationType != null ? ActivatorUtilities.CreateInstance(s, wrappedDescriptor.ImplementationType) : throw new InvalidOperationException("Unable to create instance"),
              wrappedDescriptor.Lifetime)
            );
        }

        /// <summary>
        /// Like <see cref="AddTransientForFeature{TInterface, TImplementation}(IServiceCollection, string)"/>, but resolves the feature name from an enum value.
        /// </summary>
        /// <typeparam name="TInterface">Service abstraction.</typeparam>
        /// <typeparam name="TImplementation">Implementation used when the feature is enabled.</typeparam>
        /// <param name="services">The application service collection.</param>
        /// <param name="featureName">Enum value whose name is used as the feature flag key.</param>
        /// <exception cref="ArgumentException"><paramref name="featureName"/> is not an enum or has no name.</exception>
        public static void AddTransientForFeature<TInterface, TImplementation>(this IServiceCollection services, object featureName)
             where TInterface : class
             where TImplementation : class, TInterface
        {
            var type = featureName.GetType();

            if (!type.IsEnum)
                throw new ArgumentException("The provided feature name must be an enum.", nameof(featureName));

            var name = Enum.GetName(featureName.GetType(), featureName);
            if (string.IsNullOrEmpty(name))
                throw new ArgumentException("The enum value has no registered name.", nameof(featureName));

            AddTransientForFeature<TInterface, TImplementation>(services, name);
        }

        /// <summary>
        /// Registers <typeparamref name="TImplementation"/> as transient for <typeparamref name="TInterface"/> when the feature flag is on; otherwise uses an existing registration or throws when resolving.
        /// </summary>
        /// <typeparam name="TInterface">Service abstraction.</typeparam>
        /// <typeparam name="TImplementation">Implementation type when the feature is enabled.</typeparam>
        /// <param name="services">The application service collection.</param>
        /// <param name="featureName">Feature flag name evaluated via <see cref="IFeatureManager"/>.</param>
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
                        throw new NotImplementedException($"Feature {featureName} is not enabled, and no other instance of the service is registered"),
                  ServiceLifetime.Transient)
                );
            else
                services.Replace(ServiceDescriptor.Describe(
                  typeof(TInterface),
                  serviceProvider => serviceProvider.GetRequiredService<IFeatureManager>().IsEnabledAsync(featureName).ConfigureAwait(false).GetAwaiter().GetResult() ?
                        ActivatorUtilities.CreateInstance(serviceProvider, typeof(TImplementation)) :
                        oldDescriptor.ImplementationFactory != null ? oldDescriptor.ImplementationFactory(serviceProvider) : oldDescriptor.ImplementationType != null ? ActivatorUtilities.CreateInstance(serviceProvider, oldDescriptor.ImplementationType) : throw new InvalidOperationException("Unable to create instance"),
                  ServiceLifetime.Transient)
                );
        }

        /// <summary>
        /// Like <see cref="AddScopedForFeature{TInterface, TImplementation}(IServiceCollection, string)"/>, but resolves the feature name from an enum value.
        /// </summary>
        /// <typeparam name="TInterface">Service abstraction.</typeparam>
        /// <typeparam name="TImplementation">Implementation used when the feature is enabled.</typeparam>
        /// <param name="services">The application service collection.</param>
        /// <param name="featureName">Enum value whose name is used as the feature flag key.</param>
        /// <exception cref="ArgumentException"><paramref name="featureName"/> is not an enum or has no name.</exception>
        public static void AddScopedForFeature<TInterface, TImplementation>(this IServiceCollection services, object featureName)
             where TInterface : class
             where TImplementation : class, TInterface
        {
            var type = featureName.GetType();

            if (!type.IsEnum)
                throw new ArgumentException("The provided feature name must be an enum.", nameof(featureName));

            var name = Enum.GetName(featureName.GetType(), featureName);
            if (string.IsNullOrEmpty(name))
                throw new ArgumentException("The enum value has no registered name.", nameof(featureName));

            AddScopedForFeature<TInterface, TImplementation>(services, name);
        }

        /// <summary>
        /// Registers <typeparamref name="TImplementation"/> as scoped for <typeparamref name="TInterface"/> when the feature flag is on; otherwise uses an existing registration or throws when resolving.
        /// </summary>
        /// <typeparam name="TInterface">Service abstraction.</typeparam>
        /// <typeparam name="TImplementation">Implementation type when the feature is enabled.</typeparam>
        /// <param name="services">The application service collection.</param>
        /// <param name="featureName">Feature flag name evaluated via <see cref="IFeatureManager"/>.</param>
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
                        throw new NotImplementedException($"Feature {featureName} is not enabled, and no other instance of the service is registered"),
                  ServiceLifetime.Scoped)
                );
            else
                services.Replace(ServiceDescriptor.Describe(
                  typeof(TInterface),
                  serviceProvider => serviceProvider.GetRequiredService<IFeatureManager>().IsEnabledAsync(featureName).ConfigureAwait(false).GetAwaiter().GetResult() ?
                        ActivatorUtilities.CreateInstance(serviceProvider, typeof(TImplementation)) :
                        oldDescriptor.ImplementationFactory != null ? oldDescriptor.ImplementationFactory(serviceProvider) : oldDescriptor.ImplementationType != null ? ActivatorUtilities.CreateInstance(serviceProvider, oldDescriptor.ImplementationType) : throw new InvalidOperationException("Unable to create instance"),
                  ServiceLifetime.Scoped)
                );
        }
    }
}
