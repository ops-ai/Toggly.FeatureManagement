using Finbuckle.MultiTenant;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Data;

namespace Demo.Mvc.Multitenant
{
    public class Application : TenantInfo
    {
        public Dictionary<string, List<FeatureFilter>> Definitions { get; set; }
    }
}
