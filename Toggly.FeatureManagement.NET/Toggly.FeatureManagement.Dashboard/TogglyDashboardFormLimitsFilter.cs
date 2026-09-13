using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Embedded;

namespace Toggly.FeatureManagement.Dashboard;

/// <summary>Applies dashboard-only transport limits before antiforgery reads a posted form.</summary>
public sealed class TogglyDashboardFormLimitsFilter(IOptions<TogglyEmbeddedOptions> options) : IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        if (http.GetEndpoint()?.Metadata.GetMetadata<TogglyDashboardEndpointMetadata>() == null || !HttpMethods.IsPost(http.Request.Method)) return;
        var maximum = options.Value.MaxCatalogBytes;
        // Base64 followed by form URL encoding can use four times the source bytes.
        var transportMaximum = maximum > (long.MaxValue - 65536) / 4 ? long.MaxValue : maximum * 4 + 65536;
        var requestLimit = http.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (requestLimit is { IsReadOnly: false }) requestLimit.MaxRequestBodySize = transportMaximum;
        if (http.Features.Get<IFormFeature>()?.Form != null) return;
        http.Features.Set<IFormFeature>(new FormFeature(http.Request, new FormOptions
        {
            MultipartBodyLengthLimit = maximum,
            ValueLengthLimit = (int)Math.Min(int.MaxValue, transportMaximum),
            ValueCountLimit = (int)Math.Min(int.MaxValue, maximum)
        }));
    }
}
