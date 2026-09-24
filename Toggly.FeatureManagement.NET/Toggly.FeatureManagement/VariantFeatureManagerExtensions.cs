using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Soft-bind helpers that expose typed variant configuration values from
    /// <see cref="IVariantFeatureManager"/>.
    /// </summary>
    public static class VariantFeatureManagerExtensions
    {
        /// <summary>
        /// Gets the assigned variant's configuration bound to <typeparamref name="T"/>.
        /// </summary>
        /// <typeparam name="T">Target configuration type.</typeparam>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>
        /// The bound value, or <c>default</c> when no variant is assigned or binding fails.
        /// Does not throw solely for a bind mismatch; existing MF APIs are unchanged.
        /// </returns>
        public static Task<T> GetVariantValueAsync<T>(
            this IVariantFeatureManager manager,
            string feature,
            CancellationToken cancellationToken = default)
        {
#if NET6_0_OR_GREATER
            ArgumentNullException.ThrowIfNull(manager);
#else
            if (manager == null)
                throw new ArgumentNullException(nameof(manager));
#endif

            return BindVariantValueAsync<T>(manager.GetVariantAsync(feature, cancellationToken));
        }

        /// <summary>
        /// Gets the assigned variant's configuration bound to <typeparamref name="T"/>
        /// using the provided targeting context.
        /// </summary>
        /// <typeparam name="T">Target configuration type.</typeparam>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="context">Targeting context used for variant assignment.</param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>
        /// The bound value, or <c>default</c> when no variant is assigned or binding fails.
        /// Does not throw solely for a bind mismatch; existing MF APIs are unchanged.
        /// </returns>
        public static Task<T> GetVariantValueAsync<T>(
            this IVariantFeatureManager manager,
            string feature,
            ITargetingContext context,
            CancellationToken cancellationToken = default)
        {
#if NET6_0_OR_GREATER
            ArgumentNullException.ThrowIfNull(manager);
#else
            if (manager == null)
                throw new ArgumentNullException(nameof(manager));
#endif

            return BindVariantValueAsync<T>(manager.GetVariantAsync(feature, context, cancellationToken));
        }

        private static async Task<T> BindVariantValueAsync<T>(ValueTask<Variant> variantTask)
        {
            var variant = await variantTask.ConfigureAwait(false);
            if (variant?.Configuration == null)
                return default!;

            try
            {
                return variant.Configuration.Get<T>()!;
            }
            catch
            {
                return default!;
            }
        }
    }
}
