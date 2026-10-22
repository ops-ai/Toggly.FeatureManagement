using System.Threading.Tasks;
using Microsoft.FeatureManagement;

namespace Toggly.FeatureManagement.Filters
{
    /// <summary>
    /// Builtin AlwaysOff filter — always evaluates to disabled.
    /// </summary>
    [FilterAlias("AlwaysOff")]
    public sealed class AlwaysOffFeatureFilter : IFeatureFilter
    {
        /// <inheritdoc />
        public Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context) => Task.FromResult(false);
    }
}
