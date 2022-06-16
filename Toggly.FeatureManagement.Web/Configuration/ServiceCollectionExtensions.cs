using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.FeatureManagement.FeatureFilters;
using System;
using Toggly.FeatureManagement.Configuration;

namespace Toggly.FeatureManagement.Web.Configuration
{
    public static class ServiceCollectionExtensions
    {
        public static IServiceCollection AddTogglyHttpContext(this IServiceCollection services)
        {
            services.AddHttpContextAccessor();
            services.TryAddTransient<IFeatureContextProvider, HttpFeatureContextProvider>();
            services.TryAddSingleton<ITargetingContextAccessor, HttpContextTargetingContextAccessor>();

            return services;
        }

        public static IServiceCollection AddTogglyWeb(this IServiceCollection services, Action<TogglySettings> togglyOptions)
        {
            services.AddToggly(togglyOptions);
            services.AddTogglyHttpContext();
            services.AddTogglyFeatureManagement();

            return services;
        }

        public static IServiceCollection AddTogglyWeb(this IServiceCollection services, TogglySettings togglyOptions)
        {
            services.AddToggly(togglyOptions);
            services.AddTogglyHttpContext();
            services.AddTogglyFeatureManagement();

            return services;
        }
    }
}
