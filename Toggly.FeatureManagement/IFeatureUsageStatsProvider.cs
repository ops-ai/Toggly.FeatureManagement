using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    public interface IFeatureUsageStatsProvider
    {
        Task RecordUsageAsync(string feature, bool allowed);

        Task RecordUsageAsync<TContext>(string feature, TContext context, bool allowed);
    }
}
