namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Marks endpoints deliberately mapped by <see cref="TogglyDashboardEndpointExtensions"/>.</summary>
public sealed class TogglyDashboardEndpointMetadata
{
    internal TogglyDashboardEndpointMetadata(string mountPath, string applicationName)
    {
        MountPath = mountPath;
        ApplicationName = applicationName;
    }
    /// <summary>Normalized dashboard mount path.</summary>
    public string MountPath { get; }
    /// <summary>Host application name displayed by the dashboard.</summary>
    public string ApplicationName { get; }
}
