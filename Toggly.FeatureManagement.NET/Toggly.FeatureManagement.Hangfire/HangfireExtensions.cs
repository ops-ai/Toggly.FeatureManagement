using Hangfire;
using Hangfire.Annotations;
using System;
using System.Linq.Expressions;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.HangfireExtensions
{
    public static class HangfireExtensions
    {
        public static void AddOrUpdateJob(this IFeatureStateService featureService, object featureKey, [NotNull][InstantHandle] Expression<Action> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(id.ToString());
            });
        }

        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, object featureKey, [InstantHandle][NotNull] Expression<Action<T>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(id.ToString(), methodCall, cronExpression(), timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(id.ToString());
            });
        }

        public static void AddOrUpdateJob(this IFeatureStateService featureService, object featureKey, [InstantHandle][NotNull] Expression<Action> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(id.ToString());
            });
        }

        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, object featureKey, [NotNull][InstantHandle] Expression<Action<T>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(id.ToString());
            });
        }

        public static void AddOrUpdateJob(this IFeatureStateService featureService, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Action> methodCall, [NotNull] Func<string> cronExpression, string featureName, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(recurringJobId);
            });
        }

        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Action<T>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(recurringJobId);
            });
        }

        public static void AddOrUpdateJob(this IFeatureStateService featureService, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Action> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(recurringJobId);
            });
        }

        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, object featureKey, [NotNull] string recurringJobId, [InstantHandle][NotNull] Expression<Action<T>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(recurringJobId);
            });
        }

        public static void AddOrUpdateJob(this IFeatureStateService featureService, object featureKey, [InstantHandle][NotNull] Expression<Func<Task>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(id.ToString());
            });
        }

        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, object featureKey, [InstantHandle][NotNull] Expression<Func<T, Task>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(id.ToString());
            });
        }

        public static void AddOrUpdateJob(this IFeatureStateService featureService, object featureKey, [NotNull][InstantHandle] Expression<Func<Task>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(id.ToString());
            });
        }

        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, object featureKey, [NotNull][InstantHandle] Expression<Func<T, Task>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            var id = Guid.NewGuid();
            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(id.ToString(), methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(id.ToString());
            });
        }

        public static void AddOrUpdateJob(this IFeatureStateService featureService, object featureKey, [NotNull] string recurringJobId, [InstantHandle][NotNull] Expression<Func<Task>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(recurringJobId);
            });
        }

        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Func<T, Task>> methodCall, [NotNull] Func<string> cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(recurringJobId);
            });
        }

        public static void AddOrUpdateJob(this IFeatureStateService featureService, object featureKey, [NotNull] string recurringJobId, [NotNull][InstantHandle] Expression<Func<Task>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(recurringJobId);
            });
        }

        public static void AddOrUpdateJob<T>(this IFeatureStateService featureService, object featureKey, [NotNull] string recurringJobId, [InstantHandle][NotNull] Expression<Func<T, Task>> methodCall, [NotNull] string cronExpression, [CanBeNull] TimeZoneInfo timeZone = null, [NotNull] string queue = "default")
        {
            var type = featureKey.GetType();
            if (!type.IsEnum && type != typeof(string))
                throw new ArgumentException("The provided feature name must be an enum or string.", nameof(featureKey));

            featureService.WhenFeatureTurnsOn(featureKey, () =>
            {
                RecurringJob.AddOrUpdate(recurringJobId, methodCall, cronExpression, timeZone, queue);
            });
            featureService.WhenFeatureTurnsOff(featureKey, () =>
            {
                RecurringJob.RemoveIfExists(recurringJobId);
            });
        }
    }
}
