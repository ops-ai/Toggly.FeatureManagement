﻿using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Azure;
using Microsoft.FeatureManagement.FeatureFilters;
using System;
using System.Collections.Generic;
using System.Security.Claims;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Web
{
    /// <summary>
    /// Provides an implementation of <see cref="ITargetingContextAccessor"/> that creates a targeting context using info from the current HTTP request.
    /// </summary>
    public class HttpContextTargetingContextAccessor : ITargetingContextAccessor
    {
        private const string TargetingContextLookup = "HttpContextTargetingContextAccessor.TargetingContext";
        private readonly IHttpContextAccessor _httpContextAccessor;

        public HttpContextTargetingContextAccessor(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor ?? throw new ArgumentNullException(nameof(httpContextAccessor));
        }

        public ValueTask<TargetingContext> GetContextAsync()
        {
            HttpContext httpContext = _httpContextAccessor.HttpContext!;

            //
            // Try cache lookup
            if (httpContext.Items.TryGetValue(TargetingContextLookup, out object value))
                return new ValueTask<TargetingContext>((TargetingContext)value!);
            
            ClaimsPrincipal user = httpContext.User;

            var groups = new List<string>();

            //
            // This application expects groups to be specified in the user's claims
            foreach (var claim in user.Claims)
                if (claim.Type == "group")
                    groups.Add(claim.Value);

            //
            // Build targeting context based off user info
            var targetingContext = new TargetingContext
            {
                UserId = user.Identity!.Name,
                Groups = groups
            };

            //
            // Cache for subsequent lookup
            httpContext.Items[TargetingContextLookup] = targetingContext;

            return new ValueTask<TargetingContext>(targetingContext);
        }
    }
}
