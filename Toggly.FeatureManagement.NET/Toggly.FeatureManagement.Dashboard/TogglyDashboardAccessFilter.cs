using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Embedded;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Prevents dashboard controllers from being exposed by unrelated host MVC routes.</summary>
public sealed class TogglyDashboardAccessFilter(IOptions<TogglyEmbeddedOptions> options) : IAsyncActionFilter
{
    /// <inheritdoc />
    public Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        context.HttpContext.Response.Headers.CacheControl = "private, no-store";
        var endpoint = context.HttpContext.GetEndpoint();
        if (endpoint?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>() == null)
        {
            context.Result = new NotFoundResult();
            return Task.CompletedTask;
        }

        if (!TogglyDashboardAccess.IsAllowed(context.HttpContext, endpoint) ||
            (options.Value.ReadOnly && HttpMethods.IsPost(context.HttpContext.Request.Method)))
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

        if (context.Request.Headers.Keys.Any(header =>
            header.Equals("Forwarded", StringComparison.OrdinalIgnoreCase) ||
            header.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase) ||
            header.StartsWith("X-Original-", StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        var address = context.Connection.RemoteIpAddress;
        return address != null && System.Net.IPAddress.IsLoopback(address);
    }
}
