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
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.NSwag
{
    /// <summary>Generates a Swagger specification on a given path.</summary>
    public class OpenApiDocumentMiddleware
    {
        private static readonly Func<HttpRequest, string>? DefaultDocumentCacheKey =
            new OpenApiDocumentMiddlewareSettings().CreateDocumentCacheKey;
        private readonly RequestDelegate _nextDelegate;
        private readonly string _documentName;
        private readonly string _path;
        private readonly IApiDescriptionGroupCollectionProvider _apiDescriptionGroupCollectionProvider;
        private readonly OpenApiDocumentMiddlewareSettings _settings;
        private const int MaxDocumentCacheEntries = 32;
        private readonly object _documentsCacheLock = new object();
        private readonly Dictionary<string, DocumentCacheEntry> _documentsCache =
            new Dictionary<string, DocumentCacheEntry>();
        private readonly Queue<string> _cacheInsertionOrder = new Queue<string>();
        private int _cacheGeneration;

        private sealed class DocumentCacheEntry
        {
            public DocumentCacheEntry(string? data, ExceptionDispatchInfo? exception, int apiDescriptionVersion)
            {
                Data = data;
                Exception = exception;
                ApiDescriptionVersion = apiDescriptionVersion;
                CreatedAt = DateTimeOffset.UtcNow;
            }

            public string? Data { get; }
            public ExceptionDispatchInfo? Exception { get; }
            public int ApiDescriptionVersion { get; }
            public DateTimeOffset CreatedAt { get; }
        }

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
            var featureStateService = serviceProvider.GetService<IFeatureStateService>();
            if (featureStateService != null)
            {
                try
                {
                    featureStateService.WhenDefinitionsChange(ClearDocumentsCache);
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
                context.Response.ContentType = _path.Contains(".yaml", StringComparison.OrdinalIgnoreCase) ?
                    "application/yaml; charset=utf-8" :
                    "application/json; charset=utf-8";

                await context.Response.WriteAsync(schemaJson, context.RequestAborted);
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
            var cacheKeyFactory = _settings.CreateDocumentCacheKey;
            // NSwag supplies an implicit empty-string key; only a caller-supplied key opts in.
            var documentKey = cacheKeyFactory == null || cacheKeyFactory.Equals(DefaultDocumentCacheKey)
                ? null
                : cacheKeyFactory(context.Request);
            var apiDescriptionGroups = _apiDescriptionGroupCollectionProvider.ApiDescriptionGroups;
            DocumentCacheEntry? document = null;
            int cacheGeneration;
            lock (_documentsCacheLock)
            {
                cacheGeneration = _cacheGeneration;
                if (documentKey != null)
                    _documentsCache.TryGetValue(documentKey, out document);
            }

            if (document?.ApiDescriptionVersion == apiDescriptionGroups.Version)
            {
                if (document.Exception != null &&
                    document.CreatedAt + _settings.ExceptionCacheTime > DateTimeOffset.UtcNow)
                    document.Exception.Throw();

                if (document.Data != null)
                    return document.Data;
            }

            try
            {
                context.RequestAborted.ThrowIfCancellationRequested();
                var openApiDocument = await GenerateDocumentAsync(context);
                var data = _path.Contains(".yaml", StringComparison.OrdinalIgnoreCase) ?
                    OpenApiYamlDocument.ToYaml(openApiDocument) :
                    openApiDocument.ToJson();

                XmlDocs.ClearCache();
                CachedType.ClearCache();

                if (documentKey != null && !context.RequestAborted.IsCancellationRequested)
                    StoreDocument(documentKey,
                        new DocumentCacheEntry(data, null, apiDescriptionGroups.Version), cacheGeneration);

                return data;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception exception)
            {
                if (documentKey != null && !context.RequestAborted.IsCancellationRequested)
                    StoreDocument(documentKey,
                        new DocumentCacheEntry(null, ExceptionDispatchInfo.Capture(exception),
                            apiDescriptionGroups.Version), cacheGeneration);

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

            document.Servers.Clear();
            document.Servers.Add(new OpenApiServer
            {
                Url = context.Request.GetServerUrl()
            });

            _settings.PostProcess?.Invoke(document, context.Request);

            return document;
        }

        private void StoreDocument(string key, DocumentCacheEntry document, int cacheGeneration)
        {
            lock (_documentsCacheLock)
            {
                if (cacheGeneration != _cacheGeneration)
                    return;

                if (!_documentsCache.ContainsKey(key))
                {
                    if (_documentsCache.Count == MaxDocumentCacheEntries)
                        _documentsCache.Remove(_cacheInsertionOrder.Dequeue());
                    _cacheInsertionOrder.Enqueue(key);
                }

                _documentsCache[key] = document;
            }
        }

        private void ClearDocumentsCache()
        {
            lock (_documentsCacheLock)
            {
                _cacheGeneration++;
                _documentsCache.Clear();
                _cacheInsertionOrder.Clear();
            }
        }
    }
}
