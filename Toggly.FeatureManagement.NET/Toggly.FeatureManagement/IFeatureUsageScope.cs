using System;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Tracks one feature usage attempt with duration and optional failure.
    /// Dispose (or await DisposeAsync) to record the outcome. Propagates failures after counting.
    /// </summary>
    public interface IFeatureUsageScope : IAsyncDisposable, IDisposable
    {
        /// <summary>
        /// Marks the scope as a business/technical failure without throwing.
        /// Counted once even if the body later throws.
        /// </summary>
        void Fail();

        /// <summary>
        /// Marks the scope as cancelled. Attempt stays recorded; no error and no duration.
        /// </summary>
        void MarkCancelled();
    }
}
