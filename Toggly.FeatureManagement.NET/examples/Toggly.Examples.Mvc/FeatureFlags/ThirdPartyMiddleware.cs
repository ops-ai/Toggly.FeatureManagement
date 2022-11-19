namespace Toggly.Examples.Mvc.FeatureFlags
{
    public class ThirdPartyMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger _logger;

        public ThirdPartyMiddleware(RequestDelegate next, ILoggerFactory loggerFactory)
        {
            _next = next;
            _logger = loggerFactory.CreateLogger<ThirdPartyMiddleware>();
        }

        public async Task Invoke(HttpContext httpContext)
        {
            _logger.LogInformation($"Third party middleware inward path.");

            //
            // Call the next middleware delegate in the pipeline 
            await _next.Invoke(httpContext);

            _logger.LogInformation($"Third party middleware outward path.");
        }
    }
}
