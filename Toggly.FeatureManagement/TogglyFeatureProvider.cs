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

        public TogglyFeatureProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _clientFactory = clientFactory;
            _logger = loggerFactory.CreateLogger<TogglyFeatureProvider>();
            _backgroundWorker.DoWork += BackgroundWorker_DoWork;
            _backgroundWorker.RunWorkerAsync();
        }

        private async void BackgroundWorker_DoWork(object sender, DoWorkEventArgs e)
        {
            while (true)
            {
                await RefreshFeatures();
                await Task.Delay(new TimeSpan(0, 0, 10));
            }
        }

        private async Task RefreshFeatures()
        {
            try
            {
                using (var httpClient = _clientFactory.CreateClient("toggly"))
                {
                    httpClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", Convert.ToBase64String(System.Text.Encoding.ASCII.GetBytes($"{Hashing.GetStringSha256Hash(_appKey)}:{_environment}")));
                    if (lastETag != null) httpClient.DefaultRequestHeaders.Add("etag", lastETag);
                    var newDefinitionsRequest = await httpClient.GetAsync("definitions");
                    if (newDefinitionsRequest.StatusCode == System.Net.HttpStatusCode.NotModified)
                        return;

                    newDefinitionsRequest.EnsureSuccessStatusCode();

                    var newDefinitions = await newDefinitionsRequest.Content.ReadFromJsonAsync<List<FeatureDefinitionModel>>();
                    if (newDefinitions == null)
                        return;

                    lastETag = newDefinitionsRequest.Headers.ETag.Tag;

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
                        _definitions.AddOrUpdate(featureDefinition.Name, newDefinition, (name, def) => def = newDefinition);
                    }
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
                await RefreshFeatures();

            foreach (var feature in _definitions.Values)
                yield return feature;
        }

        public async Task<FeatureDefinition?> GetFeatureDefinitionAsync(string featureName)
        {
            if (_definitions.TryGetValue(featureName, out var feature))
                return feature;

            await RefreshFeatures();

            if (_definitions.TryGetValue(featureName, out var updatedFeature))
                return updatedFeature;

            return null;
        }
    }
}
