using Microsoft.AspNetCore.Mvc.Filters;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Applies the dashboard's private no-store response policy after MVC result selection.</summary>
public sealed class TogglyDashboardNoStoreFilter : IAlwaysRunResultFilter
{
    /// <inheritdoc />
    public void OnResultExecuting(ResultExecutingContext context) => context.HttpContext.Response.Headers.CacheControl = "private, no-store";
    /// <inheritdoc />
    public void OnResultExecuted(ResultExecutedContext context)
    {
        if (!context.HttpContext.Response.HasStarted) context.HttpContext.Response.Headers.CacheControl = "private, no-store";
    }
}
