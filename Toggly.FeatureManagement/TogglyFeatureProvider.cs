﻿using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement
{
    public class TogglyFeatureProvider : IFeatureDefinitionProvider
    {
        private readonly string _appKey;

        private readonly string _environment;

        private EntityTagHeaderValue? lastETag = null;

        private readonly ConcurrentDictionary<string, FeatureDefinition> _definitions = new ConcurrentDictionary<string, FeatureDefinition>();

        private readonly ILogger _logger;

        private readonly IHttpClientFactory _clientFactory;

        private readonly IFeatureSnapshotProvider? _snapshotProvider;

        private bool _loaded = false;

        private readonly Timer _timer;

        public TogglyFeatureProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IServiceProvider serviceProvider)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _clientFactory = clientFactory;
            _snapshotProvider = (IFeatureSnapshotProvider?)serviceProvider.GetService(typeof(IFeatureSnapshotProvider));

            _logger = loggerFactory.CreateLogger<TogglyFeatureProvider>();

            _timer = new Timer((s) => RefreshFeatures(new TimeSpan(0, 0, 5).Ticks).ConfigureAwait(false), null, TimeSpan.Zero, new TimeSpan(0, 0, 10));
        }

        private async Task LoadSnapshot()
        {
            try
            {
                if (_snapshotProvider != null)
                {
                    var snapshot = await _snapshotProvider.GetFeaturesSnapshotAsync().ConfigureAwait(false);

                    if (snapshot != null)
                        foreach (var featureDefinition in snapshot)
                        {
                            var newDefinition = new FeatureDefinition
                            {
                                Name = featureDefinition.FeatureKey,
                                EnabledFor = featureDefinition.Filters.Select(featureFilter =>
                                    new FeatureFilterConfiguration
                                    {
                                        Name = featureFilter.Name,
                                        Parameters = new ConfigurationBuilder().AddInMemoryCollection(featureFilter.Parameters).Build()
                                    })
                            };
                            _definitions.AddOrUpdate(featureDefinition.FeatureKey, newDefinition, (name, def) => def = newDefinition);
                        }
                }
            }
            catch (Exception ex2)
            {
                _logger.LogError(ex2, "Error loading from snapshot");
            }
        }

        private async Task RefreshFeatures(long? timeout = null)
        {
            try
            {
                using var httpClient = _clientFactory.CreateClient("toggly");
                if (timeout.HasValue)
                    httpClient.Timeout = new TimeSpan(timeout.Value);
                if (lastETag != null) httpClient.DefaultRequestHeaders.IfNoneMatch.Add(lastETag);
                var newDefinitionsRequest = await httpClient.GetAsync($"definitions/{_appKey}/{_environment}").ConfigureAwait(false);
                if (newDefinitionsRequest.StatusCode == System.Net.HttpStatusCode.NotModified)
                    return;

                newDefinitionsRequest.EnsureSuccessStatusCode();

                var newDefinitions = await newDefinitionsRequest.Content.ReadFromJsonAsync<List<FeatureDefinitionModel>>().ConfigureAwait(false);
                if (newDefinitions == null)
                    return;

                lastETag = newDefinitionsRequest.Headers.ETag;

                foreach (var featureDefinition in newDefinitions)
                {
                    var newDefinition = new FeatureDefinition
                    {
                        Name = featureDefinition.FeatureKey,
                        EnabledFor = featureDefinition.Filters.Select(featureFilter =>
                            new FeatureFilterConfiguration
                            {
                                Name = featureFilter.Name,
                                Parameters = new ConfigurationBuilder().AddInMemoryCollection(featureFilter.Parameters).Build()
                            })
                    };

                    _definitions.AddOrUpdate(featureDefinition.FeatureKey, newDefinition, (name, def) => def = newDefinition);
                }
                _loaded = true;

                if (_snapshotProvider != null)
                    await _snapshotProvider.SaveSnapshotAsync(newDefinitions).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error refreshing features list");
                if (!_loaded)
                {
                    await LoadSnapshot().ConfigureAwait(false);
                    _loaded = true;
                }
            }
        }

        public async IAsyncEnumerable<FeatureDefinition> GetAllFeatureDefinitionsAsync()
        {
            if (!_loaded)
            {
                var i = 0;
                while (!_loaded && i < 5)
                {
                    await Task.Delay(500).ConfigureAwait(false);
                    i++;
                }
            }

            foreach (var feature in _definitions.Values)
                yield return feature;
        }

        public async Task<FeatureDefinition> GetFeatureDefinitionAsync(string featureName)
        {
            if (!_loaded)
            {
                var i = 0;
                while (!_loaded && i < 5)
                {
                    await Task.Delay(500).ConfigureAwait(false);
                    i++;
                }
            }

            if (_definitions.TryGetValue(featureName, out var updatedFeature))
                return updatedFeature;

            return new FeatureDefinition {  Name = featureName, EnabledFor = new List<FeatureFilterConfiguration>() };
        }
    }
}
