namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Marks endpoints deliberately mapped by <see cref="TogglyDashboardEndpointExtensions"/>.</summary>
public sealed class TogglyDashboardEndpointMetadata
{
    internal TogglyDashboardEndpointMetadata(string mountPath) => MountPath = mountPath;
    /// <summary>Normalized dashboard mount path.</summary>
    public string MountPath { get; }
}
