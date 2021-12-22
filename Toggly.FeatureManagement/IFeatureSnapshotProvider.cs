using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement
{
    public interface IFeatureSnapshotProvider
    {
        Task SaveSnapshotAsync(List<FeatureDefinitionModel> features, CancellationToken ct = default);

        Task<List<FeatureDefinitionModel>?> GetFeaturesSnapshotAsync(CancellationToken ct = default);
    }
}
