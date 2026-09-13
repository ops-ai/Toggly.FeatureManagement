using System;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Optional runtime seam that pins a definition snapshot for one Toggly evaluation.
    /// Cloud registration intentionally does not supply this service.
    /// </summary>
    internal interface IEvaluationSnapshotScope
    {
        IDisposable BeginScope();
    }
}
