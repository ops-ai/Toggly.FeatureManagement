using Azure.Messaging.WebPubSub;
using ConcurrentCollections;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;
using Websocket.Client;

namespace Toggly.FeatureManagement
{
    public class TogglyFeatureProvider : IFeatureDefinitionProvider, IDisposable, IFeatureExperimentProvider, IFeatureProviderDebug
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

        private readonly string Version;

        private readonly ConcurrentDictionary<string, ConcurrentHashSet<string>> _experiments = new ConcurrentDictionary<string, ConcurrentHashSet<string>>();

        private WebsocketClient? _webSocketClient = null;

        public TogglyFeatureProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IServiceProvider serviceProvider)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _clientFactory = clientFactory;
            _snapshotProvider = (IFeatureSnapshotProvider?)serviceProvider.GetService(typeof(IFeatureSnapshotProvider));

            _logger = loggerFactory.CreateLogger<TogglyFeatureProvider>();

            _timer = new Timer((s) => RefreshFeatures(new TimeSpan(0, 0, 10).Ticks).ConfigureAwait(false), null, TimeSpan.Zero, new TimeSpan(0, 5, 0));
            Version = $"{Assembly.GetAssembly(typeof(TogglyFeatureProvider))?.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version}";
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

        private string _lastError = string.Empty;
        private DateTime? _lastErrorTime = null;
        private DateTime? _lastRefresh = null;

        private async Task RefreshFeatures(long? timeout = null)
        {
            try
            {
                using var httpClient = _clientFactory.CreateClient("toggly");
#if NETCOREAPP3_1_OR_GREATER
                httpClient.DefaultRequestVersion = HttpVersion.Version20;
#endif
                httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Toggly.FeatureManagement", Version));
                if (timeout.HasValue)
                    httpClient.Timeout = new TimeSpan(timeout.Value);
                if (lastETag != null) httpClient.DefaultRequestHeaders.IfNoneMatch.Add(lastETag);
                var newDefinitionsRequest = await httpClient.GetAsync($"definitions/{_appKey}/{_environment}").ConfigureAwait(false);
                if (newDefinitionsRequest.StatusCode == HttpStatusCode.NotModified)
                    return;

                newDefinitionsRequest.EnsureSuccessStatusCode();

                var newDefinitions = await newDefinitionsRequest.Content.ReadFromJsonAsync<List<FeatureDefinitionModel>>().ConfigureAwait(false);
                if (newDefinitions == null)
                {
                    _logger.LogWarning("Received empty response from toggly");
                    return;
                }

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
                var activeExperiments = newDefinitions.Where(t => t.Metrics != null).SelectMany(t => t.Metrics).GroupBy(t => t).Select(t => t.Key).ToList();
                _experiments.Clear();
                foreach (var activeExperiment in activeExperiments)
                    _experiments.TryAdd(activeExperiment, new ConcurrentHashSet<string>(newDefinitions.Where(t => t.Metrics != null && t.Metrics.Contains(activeExperiment)).Select(t => t.FeatureKey)));

                _loaded = true;
                if (_webSocketClient == null || !_webSocketClient.IsRunning)
                {
                    var liveUpdateResponse = await httpClient.GetAsync($"definitions/live-updates/{_appKey}/{_environment}").ConfigureAwait(false);
                    if (liveUpdateResponse.IsSuccessStatusCode)
                    {
                        var liveUpdateConnectionString = await liveUpdateResponse.Content.ReadAsStringAsync().ConfigureAwait(false);
                        if (Uri.TryCreate(liveUpdateConnectionString, UriKind.Absolute, out var liveConnectionUri))
                        {
                            _webSocketClient = new WebsocketClient(liveConnectionUri) { ReconnectTimeout = null };
                            _webSocketClient.MessageReceived.Subscribe(msg =>
                            {
                                if (msg.Text == "update") _ = RefreshFeatures(new TimeSpan(0, 0, 10).Ticks).ConfigureAwait(false);
                            });
                            await _webSocketClient.StartOrFail().ConfigureAwait(false);
                        }
                    }
                    else
                    {
                        _lastErrorTime = DateTime.UtcNow;
                        _lastError = await liveUpdateResponse.Content.ReadAsStringAsync();
                    }
                }

                if (_snapshotProvider != null)
                    await _snapshotProvider.SaveSnapshotAsync(newDefinitions).ConfigureAwait(false);

                _lastRefresh = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error refreshing features list");
                _lastError = ex.Message;
                _lastErrorTime = DateTime.UtcNow;
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

        public void Dispose()
        {
            _timer.Dispose();
        }

        public List<string>? GetFeaturesForMetric(string metricKey)
        {
            if (_experiments.TryGetValue(metricKey, out var features))
                return features.ToList();
            return null;
        }

        public FeatureProviderDebugInfo GetDebugInfo()
        {
            return new FeatureProviderDebugInfo
            {
                AppKey = _appKey,
                Environment = _environment,
                Definitions = _definitions,
                Experiments = _experiments,
                UserAgent = new ProductInfoHeaderValue("Toggly.FeatureManagement", Version).ToString(),
                LastError = _lastError,
                LastErrorTime = _lastErrorTime,
                LastRefresh = _lastRefresh,
                WebsocketClientRunning = _webSocketClient?.IsRunning ?? false,
                Loaded = _loaded
            };
        }
    }

    public class FeatureProviderDebugInfo
    {
        public string? AppKey { get; set; }

        public string? Environment { get; set; }

        public ConcurrentDictionary<string, FeatureDefinition>? Definitions { get; set; }

        public ConcurrentDictionary<string, ConcurrentHashSet<string>>? Experiments { get; set; }

        public string? UserAgent { get; set; }

        public string? LastError { get; set; }

        public DateTime? LastErrorTime { get; set; }

        public DateTime? LastRefresh { get; set; }

        public bool WebsocketClientRunning { get; set; }

        public bool Loaded { get; set; }
    }
}
