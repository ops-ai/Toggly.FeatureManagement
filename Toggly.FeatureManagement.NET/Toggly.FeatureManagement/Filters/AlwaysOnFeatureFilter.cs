using System.Threading.Tasks;
using Microsoft.FeatureManagement;

namespace Toggly.FeatureManagement.Filters
{
    /// <summary>
    /// Builtin AlwaysOn filter — always evaluates to enabled.
    /// </summary>
    [FilterAlias("AlwaysOn")]
    public sealed class AlwaysOnFeatureFilter : IFeatureFilter
    {
        /// <inheritdoc />
        public Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context) => Task.FromResult(true);
    }
}
