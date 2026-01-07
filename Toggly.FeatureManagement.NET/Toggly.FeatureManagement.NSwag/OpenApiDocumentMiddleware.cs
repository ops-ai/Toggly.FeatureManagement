//-----------------------------------------------------------------------
// <copyright file="SwaggerMiddleware.cs" company="NSwag">
//     Copyright (c) Rico Suter. All rights reserved.
// </copyright>
// <license>https://github.com/RicoSuter/NSwag/blob/master/LICENSE.md</license>
// <author>Rico Suter, mail@rsuter.com</author>
//-----------------------------------------------------------------------

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.Extensions.DependencyInjection;
using Namotion.Reflection;
using NSwag;
using NSwag.AspNetCore;
using NSwag.AspNetCore.Middlewares;
using NSwag.Generation;
using System;
using System.Collections.Generic;
using System.Runtime.ExceptionServices;
using System.Threading;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.NSwag
{
    /// <summary>Generates a Swagger specification on a given path.</summary>
    public class OpenApiDocumentMiddleware
    {
        private readonly RequestDelegate _nextDelegate;
        private readonly string _documentName;
        private readonly string _path;
        private readonly IApiDescriptionGroupCollectionProvider _apiDescriptionGroupCollectionProvider;
        private readonly OpenApiDocumentMiddlewareSettings _settings;
        private readonly IFeatureStateService? _featureStateService;
        private readonly Guid? _definitionsChangedSubscriptionId;

        private int _version;
        private readonly object _documentsCacheLock = new object();
        private readonly Dictionary<string, Tuple<string, ExceptionDispatchInfo, DateTimeOffset>> _documentsCache = new Dictionary<string, Tuple<string, ExceptionDispatchInfo, DateTimeOffset>>();

        /// <summary>Initializes a new instance of the <see cref="OpenApiDocumentMiddleware"/> class.</summary>
        /// <param name="nextDelegate">The next delegate.</param>
        /// <param name="serviceProvider">The service provider.</param>
        /// <param name="documentName">The document name.</param>
        /// <param name="path">The document path.</param>
        /// <param name="settings">The settings.</param>
        public OpenApiDocumentMiddleware(RequestDelegate nextDelegate, IServiceProvider serviceProvider, string documentName, string path, OpenApiDocumentMiddlewareSettings settings)
        {
            _nextDelegate = nextDelegate;

            _documentName = documentName;
            _path = path.StartsWith('/') ? path : '/' + path;

            _apiDescriptionGroupCollectionProvider = serviceProvider.GetService<IApiDescriptionGroupCollectionProvider>() ??
                throw new InvalidOperationException("API Explorer not registered in DI.");

            _settings = settings;
            _featureStateService = serviceProvider.GetService<IFeatureStateService>();
            if (_featureStateService != null)
            {
                try
                {
                    _definitionsChangedSubscriptionId = _featureStateService.WhenDefinitionsChange(ClearDocumentsCache);
                }
                catch
                {
                    // best-effort; ignore if subscription fails
                }
            }
        }

        /// <summary>Invokes the specified context.</summary>
        /// <param name="context">The context.</param>
        /// <returns>The task.</returns>
        public async Task Invoke(HttpContext context)
        {
            if (context.Request.Path.HasValue && string.Equals(context.Request.Path.Value, _path, StringComparison.OrdinalIgnoreCase))
            {
                var schemaJson = await GetDocumentAsync(context);
                context.Response.StatusCode = 200;
                context.Response.Headers["Content-Type"] = _path.Contains(".yaml", StringComparison.OrdinalIgnoreCase) ?
                    "application/yaml; charset=utf-8" :
                    "application/json; charset=utf-8";

                await context.Response.WriteAsync(schemaJson);
            }
            else
            {
                await _nextDelegate(context);
            }
        }

        /// <summary>Generates or gets the cached Swagger specification.</summary>
        /// <param name="context">The context.</param>
        /// <returns>The Swagger specification.</returns>
        protected virtual async Task<string> GetDocumentAsync(HttpContext context)
        {
            var documentKey = _settings.CreateDocumentCacheKey?.Invoke(context.Request) ?? string.Empty;

            Tuple<string, ExceptionDispatchInfo, DateTimeOffset> document;
            lock (_documentsCacheLock)
            {
                _documentsCache.TryGetValue(documentKey, out document);
            }

            if (document?.Item2 != null &&
                document.Item3 + _settings.ExceptionCacheTime > DateTimeOffset.UtcNow)
            {
                document.Item2.Throw();
            }

            var apiDescriptionGroups = _apiDescriptionGroupCollectionProvider.ApiDescriptionGroups;
            if (apiDescriptionGroups.Version == Volatile.Read(ref _version) &&
                document?.Item1 != null)
            {
                return document.Item1;
            }

            try
            {
                var openApiDocument = await GenerateDocumentAsync(context);
                var data = _path.Contains(".yaml", StringComparison.OrdinalIgnoreCase) ?
                    OpenApiYamlDocument.ToYaml(openApiDocument) :
                    openApiDocument.ToJson();

                XmlDocs.ClearCache();
                CachedType.ClearCache();

                _version = apiDescriptionGroups.Version;

                lock (_documentsCacheLock)
                {
                    _documentsCache[documentKey] = new Tuple<string, ExceptionDispatchInfo, DateTimeOffset>(
                        data, null, DateTimeOffset.UtcNow);
                }

                return data;
            }
            catch (Exception exception)
            {
                lock (_documentsCacheLock)
                {
                    _documentsCache[documentKey] = new Tuple<string, ExceptionDispatchInfo, DateTimeOffset>(
                        null, ExceptionDispatchInfo.Capture(exception), DateTimeOffset.UtcNow);
                }

                throw;
            }
        }

        /// <summary>Generates the Swagger specification.</summary>
        /// <param name="context">The context.</param>
        /// <returns>The Swagger specification.</returns>
        protected virtual async Task<OpenApiDocument> GenerateDocumentAsync(HttpContext context)
        {
            var gen = context.RequestServices.GetRequiredService<IOpenApiDocumentGenerator>();
            var document = await gen.GenerateAsync(_documentName);

            // var document = await _documentProvider.GenerateAsync(_documentName);

            document.Servers.Clear();
            document.Servers.Add(new OpenApiServer
            {
                Url = context.Request.GetServerUrl()
            });

            _settings.PostProcess?.Invoke(document, context.Request);

            return document;
        }

        private void ClearDocumentsCache()
        {
            lock (_documentsCacheLock)
            {
                _documentsCache.Clear();
            }
        }
    }
}