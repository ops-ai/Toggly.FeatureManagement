using Hangfire;
using Hangfire.Annotations;
using System;
using System.Linq.Expressions;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.HangfireExtensions
{
    /// <summary>
    /// Hangfire extensions for Toggly feature management, allowing to add or update recurring jobs when a feature turns on or off.
    /// Uses <see cref="IRecurringJobManager"/> from DI so jobs can be registered without <see cref="JobStorage.Current"/> (e.g. web process with Hangfire server disabled).
    /// </summary>
    public static class HangfireExtensions
    {
        private static IRecurringJobManager ResolveRecurringJobManager(IServiceProvider serviceProvider)
        {
            return (IRecurringJobManager?)serviceProvider.GetService(typeof(IRecurringJobManager))
                ?? throw new InvalidOperationException(
                    "IRecurringJobManager is not registered. Call services.AddHangfire(...) so Hangfire registers recurring job APIs.");
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        /// <param name="serviceProvider">Root or scoped provider that can resolve <see cref="IRecurringJobManager"/> (e.g. <c>app.ApplicationServices</c>).</param>
        public static void AddOrUpdateJob(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull][InstantHandle] Expression<Action> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(id.ToString());
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [InstantHandle][NotNull] Expression<Action<T>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(id.ToString(), methodCall, cronExpression(), timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(id.ToString());
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [InstantHandle][NotNull] Expression<Action> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(id.ToString());
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull][InstantHandle] Expression<Action<T>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(id.ToString());
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Action> methodCall, [NotNull] Func<string> cronExpression, string featureName, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(recurringJobId);
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Action<T>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(recurringJobId);
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Action> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(recurringJobId);
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull] string recurringJobId, [InstantHandle][NotNull] Expression<Action<T>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(recurringJobId);
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [InstantHandle][NotNull] Expression<Func<Task>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(id.ToString());
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [InstantHandle][NotNull] Expression<Func<T, Task>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(id.ToString());
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull][InstantHandle] Expression<Func<Task>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(id.ToString());
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull][InstantHandle] Expression<Func<T, Task>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(id.ToString());
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull] string recurringJobId, [InstantHandle][NotNull] Expression<Func<Task>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(recurringJobId);
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Func<T, Task>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(recurringJobId);
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Func<Task>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(recurringJobId);
            });
        }

        /// <summary>
        /// Add or update a recurring job that will be registered when the feature turns on.
        /// </summary>
        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, IServiceProvider serviceProvider, object featureKey, [NotNull] string recurringJobId, [InstantHandle][NotNull] Expression<Func<T, Task>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo? timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                ResolveRecurringJobManager(serviceProvider).RemoveIfExists(recurringJobId);
            });
        }
    }
}
