using Microsoft.AspNetCore.Http;
using System;

namespace Toggly.FeatureManagement.Web
{
    /// <summary>
    /// Resolves request country from common CDN / edge headers (filter-parity contract).
    /// </summary>
    internal static class HttpRequestCountryResolver
    {
        private static readonly string[] CountryHeaderNames =
        {
            "CF-IPCountry",
            "X-Vercel-IP-Country",
            "CloudFront-Viewer-Country"
        };

        internal static string? ResolveCountry(HttpContext? httpContext)
        {
            if (httpContext == null)
                return null;

            var headers = httpContext.Request.Headers;
            foreach (var name in CountryHeaderNames)
            {
                if (headers.TryGetValue(name, out var value))
                {
                    var country = value.ToString();
                    if (!string.IsNullOrWhiteSpace(country))
                        return country;
                }
            }

            return null;
        }
    }
}
