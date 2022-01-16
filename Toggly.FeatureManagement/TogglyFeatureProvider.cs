using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement
{
    public class TogglyFeatureProvider : IFeatureDefinitionProvider
    {
        private readonly string _appKey;

        private readonly string _environment;

        private string? lastETag = null;

        private ConcurrentDictionary<string, FeatureDefinition> _definitions = new ConcurrentDictionary<string, FeatureDefinition>();

        private readonly ILogger _logger;

        private readonly IHttpClientFactory _clientFactory;

        private BackgroundWorker _backgroundWorker = new BackgroundWorker();

        private readonly IFeatureSnapshotProvider? _snapshotProvider;

        public TogglyFeatureProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IServiceProvider serviceProvider)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _clientFactory = clientFactory;
            _snapshotProvider = (IFeatureSnapshotProvider?)serviceProvider.GetService(typeof(IFeatureSnapshotProvider));

            _logger = loggerFactory.CreateLogger<TogglyFeatureProvider>();
            _backgroundWorker.DoWork += BackgroundWorker_DoWork;
            _backgroundWorker.RunWorkerAsync();
        }

#pragma warning disable VSTHRD100 // Avoid async void methods
        private async void BackgroundWorker_DoWork(object sender, DoWorkEventArgs e)
#pragma warning restore VSTHRD100 // Avoid async void methods
        {
            try
            {
                await RefreshFeatures(new TimeSpan(0, 0, 2).Ticks).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error loading initial features");
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

            while (true)
            {
                await Task.Delay(new TimeSpan(0, 0, 10)).ConfigureAwait(false);
                await RefreshFeatures().ConfigureAwait(false);
            }
        }

        private async Task RefreshFeatures(long? timeout = null)
        {
            try
            {
                using (var httpClient = _clientFactory.CreateClient("toggly"))
                {
                    if (timeout.HasValue)
                        httpClient.Timeout = new TimeSpan(timeout.Value);
                    if (lastETag != null) httpClient.DefaultRequestHeaders.Add("etag", lastETag);
                    var newDefinitionsRequest = await httpClient.GetAsync($"definitions/{_appKey}/{_environment}").ConfigureAwait(false);
                    if (newDefinitionsRequest.StatusCode == System.Net.HttpStatusCode.NotModified)
                        return;

                    newDefinitionsRequest.EnsureSuccessStatusCode();

                    var newDefinitions = await newDefinitionsRequest.Content.ReadFromJsonAsync<List<FeatureDefinitionModel>>().ConfigureAwait(false);
                    if (newDefinitions == null)
                        return;

                    //lastETag = newDefinitionsRequest.Headers.ETag.Tag;

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

                    if (_snapshotProvider != null)
                        await _snapshotProvider.SaveSnapshotAsync(newDefinitions).ConfigureAwait(false);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error refreshing features list");
            }
        }

        public async IAsyncEnumerable<FeatureDefinition> GetAllFeatureDefinitionsAsync()
        {
            if (_definitions.IsEmpty)
                await RefreshFeatures().ConfigureAwait(false);

            foreach (var feature in _definitions.Values)
                yield return feature;
        }

        public async Task<FeatureDefinition?> GetFeatureDefinitionAsync(string featureName)
        {
            if (_definitions.TryGetValue(featureName, out var feature))
                return feature;

            await RefreshFeatures().ConfigureAwait(false);

            if (_definitions.TryGetValue(featureName, out var updatedFeature))
                return updatedFeature;

            return null;
        }
    }
}
