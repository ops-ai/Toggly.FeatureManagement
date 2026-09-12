using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Http;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Prevents dashboard controllers from being exposed by unrelated host MVC routes.</summary>
public sealed class TogglyDashboardAccessFilter : IAsyncActionFilter
{
    /// <inheritdoc />
    public Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var endpoint = context.HttpContext.GetEndpoint();
        if (endpoint?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>() == null)
        {
            context.Result = new NotFoundResult();
            return Task.CompletedTask;
        }

        if (!TogglyDashboardAccess.IsAllowed(context.HttpContext, endpoint))
        {
            context.Result = new StatusCodeResult(StatusCodes.Status403Forbidden);
            return Task.CompletedTask;
        }

        return next();
    }
}

internal static class TogglyDashboardAccess
{
    internal static bool IsAllowed(HttpContext context, Endpoint endpoint)
    {
        if (endpoint.Metadata.GetMetadata<IAllowAnonymous>() != null)
        {
            return false;
        }

        if (endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Count > 0)
        {
            return true;
        }

        if (context.Request.Headers.ContainsKey("Forwarded") ||
            context.Request.Headers.ContainsKey("X-Forwarded-For") ||
            context.Request.Headers.ContainsKey("X-Forwarded-Host") ||
            context.Request.Headers.ContainsKey("X-Original-For"))
        {
            return false;
        }

        var address = context.Connection.RemoteIpAddress;
        return address != null && System.Net.IPAddress.IsLoopback(address);
    }
}
