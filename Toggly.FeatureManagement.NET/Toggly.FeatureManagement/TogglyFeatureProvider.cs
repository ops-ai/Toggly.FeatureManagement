using ConcurrentCollections;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
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
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;
using Websocket.Client;
using System.Text.Json.Serialization;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Toggly feature provider
    /// </summary>
    public class TogglyFeatureProvider : IFeatureDefinitionProvider, IDisposable, IFeatureExperimentProvider, IFeatureProviderDebug, ISecureFeatureProvider
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

        private readonly IFeatureStateInternalService _featureStateService;

        private readonly IServiceProvider _serviceProvider;

        private readonly bool _enabledByDefault;

        private readonly bool _useSignedDefinitions;

        private ConcurrentHashSet<string> _secureFeatures = new ConcurrentHashSet<string>();

        private readonly ConcurrentDictionary<string, (ECDsa Key, DateTime Expiry)> _ecDsaKeys = new ConcurrentDictionary<string, (ECDsa Key, DateTime Expiry)>();

        private readonly IOptions<TogglySettings> _settings;

        private long _lastDefinitionsTimestamp;

        /// <summary>
        /// Constructor
        /// </summary>
        /// <param name="togglySettings"></param>
        /// <param name="environment"></param>
        /// <param name="loggerFactory"></param>
        /// <param name="clientFactory"></param>
        /// <param name="serviceProvider"></param>
        public TogglyFeatureProvider(IOptions<TogglySettings> togglySettings, IHostEnvironment environment, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IServiceProvider serviceProvider)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _enabledByDefault = togglySettings.Value.UndefinedEnabledOnDevelopment && environment.IsDevelopment();
            _useSignedDefinitions = togglySettings.Value.UseSignedDefinitions;
            _clientFactory = clientFactory;
            _serviceProvider = serviceProvider;
            _snapshotProvider = (IFeatureSnapshotProvider?)serviceProvider.GetService(typeof(IFeatureSnapshotProvider));
            _featureStateService = (IFeatureStateInternalService)serviceProvider.GetRequiredService(typeof(IFeatureStateInternalService));
            _settings = togglySettings;

            _logger = loggerFactory.CreateLogger<TogglyFeatureProvider>();

            _timer = new Timer((s) => RefreshFeatures(new TimeSpan(0, 5, 0).Ticks).ConfigureAwait(false), null, TimeSpan.Zero, new TimeSpan(0, 5, 0));
            Version = $"{Assembly.GetAssembly(typeof(TogglyFeatureProvider))?.GetCustomAttribute<AssemblyVersionAttribute>()?.Version}";
        }

        private async Task LoadSnapshot()
        {
            try
            {
                if (_snapshotProvider != null)
                {
                    var snapshot = await _snapshotProvider.GetFeaturesSnapshotAsync().ConfigureAwait(false);
                    if (snapshot.Features != null)
                    {
                        if (_useSignedDefinitions)
                        {
                            if (snapshot.Signature == null || snapshot.KeyId == null || snapshot.Timestamp == null)
                            {
                                _logger.LogWarning("Snapshot is missing required signature fields");
                                return;
                            }

                            //validate signature
                            var signature = Convert.FromBase64String(snapshot.Signature);
                            var ecdsa = await GetEcdsaKey(snapshot.KeyId).ConfigureAwait(false);
                            if (ecdsa == null)
                            {
                                _logger.LogError("No ES256 key found in JWKS");
                                return;
                            }
                            var serializerOptions = new JsonSerializerOptions
                            {
                                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                                DictionaryKeyPolicy = null, // Don't change dictionary key casing
                                WriteIndented = false,
                                // DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
                                Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
                            };
                            
                            var jsonData = JsonSerializer.Serialize(snapshot.Features, serializerOptions);
                            var dataToVerify = $"{jsonData}|{snapshot.Timestamp}";
                            var hash = SHA256.Create().ComputeHash(Encoding.UTF8.GetBytes(dataToVerify));
                            if (!ecdsa!.VerifyHash(hash, signature))
                            {
                                _logger.LogError("Invalid signature");
                                return;
                            }
                        }

                        foreach (var featureDefinition in snapshot.Features)
                        {
                            var newDefinition = new FeatureDefinition
                            {
                                Name = featureDefinition.FeatureKey,
                                EnabledFor = featureDefinition.Filters.Select(featureFilter =>
                                    new FeatureFilterConfiguration
                                    {
                                        Name = featureFilter.Name,
                                        Parameters = new ConfigurationBuilder().AddInMemoryCollection(featureFilter.Parameters).Build()
                                    }),
                                RequirementType = featureDefinition.RequirementType
                            };
                            if (featureDefinition.SecuredFeature) _secureFeatures.Add(featureDefinition.FeatureKey);
                            else _secureFeatures.TryRemove(featureDefinition.FeatureKey);
                            _definitions.AddOrUpdate(featureDefinition.FeatureKey, newDefinition, (name, def) => def = newDefinition);
                            _featureStateService.UpdateFeatureState(featureDefinition.FeatureKey, newDefinition.EnabledFor.Any(s => s.Name == "AlwaysOn"));
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error loading from snapshot");
            }
        }

        private string _lastError = string.Empty;
        private DateTime? _lastErrorTime = null;
        private DateTime? _lastRefresh = null;
        private IMetricsService? _metricsService = null;
        
        private async Task RefreshFeatures(long? timeout = null)
        {
            try
            {
                if (!_loaded)
                {
                    await LoadSnapshot().ConfigureAwait(false);
                    _loaded = true;
                }

                _metricsService ??= _serviceProvider.GetRequiredService<IMetricsService>();
                
                using var httpClient = _clientFactory.CreateClient("toggly");
#if NETCOREAPP3_1_OR_GREATER
                httpClient.DefaultRequestVersion = HttpVersion.Version20;
#endif
                httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Toggly.FeatureManagement", Version));
                if (timeout.HasValue)
                    httpClient.Timeout = new TimeSpan(timeout.Value);
                if (lastETag != null) httpClient.DefaultRequestHeaders.IfNoneMatch.Add(lastETag);

                List<FeatureDefinitionModel>? newDefinitions;
                if (_useSignedDefinitions)
                {
                    var newDefinitionsRequest = await httpClient.GetAsync($"definitions/v2/{_appKey}/{_environment}").ConfigureAwait(false);
                    if (newDefinitionsRequest.StatusCode == HttpStatusCode.NotModified)
                        return;

                    newDefinitionsRequest.EnsureSuccessStatusCode();

                    // Get the raw JSON string first
                    var rawJson = await newDefinitionsRequest.Content.ReadAsStringAsync().ConfigureAwait(false);
                    var signedDefinitionsResponse = JsonSerializer.Deserialize<SignedDefinitionsResponse>(rawJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (signedDefinitionsResponse == null)
                    {
                        _logger.LogWarning("Received empty response from toggly");
                        return;
                    }

                    // Check timestamp
                    if (signedDefinitionsResponse.Timestamp < _lastDefinitionsTimestamp)
                    {
                        _logger.LogWarning("Received definitions with older timestamp. Current: {CurrentTimestamp}, Received: {ReceivedTimestamp}", 
                            _lastDefinitionsTimestamp, signedDefinitionsResponse.Timestamp);
                        return;
                    }

                    // Extract the raw data portion from the JSON
                    var jsonDoc = JsonDocument.Parse(rawJson);
                    var dataElement = jsonDoc.RootElement.GetProperty("defs");
                    var rawData = dataElement.GetRawText();

                    // Create data string to verify using the raw JSON
                    var dataToVerify = $"{rawData}|{signedDefinitionsResponse.Timestamp}";
                    _logger.LogDebug("Data to verify: {DataToVerify}", dataToVerify);
                    
                    var dataBytes = Encoding.UTF8.GetBytes(dataToVerify);
                    var hash = SHA256.Create().ComputeHash(dataBytes);
                    _logger.LogDebug("Hash (hex): {Hash}", BitConverter.ToString(hash).Replace("-", ""));

                    // Verify signature
                    var signature = Convert.FromBase64String(signedDefinitionsResponse.Signature);
                    _logger.LogDebug("Signature length: {Length}", signature.Length);
                    _logger.LogDebug("Signature (hex): {Signature}", BitConverter.ToString(signature).Replace("-", ""));

                    var ecdsa = await GetEcdsaKey(signedDefinitionsResponse.Kid).ConfigureAwait(false);
                    if (ecdsa == null)
                    {
                        _logger.LogError("No ES256 key found in JWKS");
                        return;
                    }

                    if (!ecdsa.VerifyHash(hash, signature))
                    {
                        _logger.LogError("Invalid signature");
                        return;
                    }

                    newDefinitions = signedDefinitionsResponse.Defs;
                    lastETag = newDefinitionsRequest.Headers.ETag;
                    _lastDefinitionsTimestamp = signedDefinitionsResponse.Timestamp;

                    if (_snapshotProvider != null)
                        await _snapshotProvider.SaveSnapshotAsync(newDefinitions, signedDefinitionsResponse.Signature, signedDefinitionsResponse.Kid, signedDefinitionsResponse.Timestamp).ConfigureAwait(false);
                }
                else
                {
                    var newDefinitionsRequest = await httpClient.GetAsync($"definitions/{_appKey}/{_environment}").ConfigureAwait(false);
                    if (newDefinitionsRequest.StatusCode == HttpStatusCode.NotModified)
                        return;

                    newDefinitionsRequest.EnsureSuccessStatusCode();

                    newDefinitions = await newDefinitionsRequest.Content.ReadFromJsonAsync<List<FeatureDefinitionModel>>().ConfigureAwait(false);
                    if (newDefinitions == null)
                    {
                        _logger.LogWarning("Received empty response from toggly");
                        return;
                    }

                    lastETag = newDefinitionsRequest.Headers.ETag;
                    if (_snapshotProvider != null)
                        await _snapshotProvider.SaveSnapshotAsync(newDefinitions).ConfigureAwait(false);
                }

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
                    if (featureDefinition.SecuredFeature) _secureFeatures.Add(featureDefinition.FeatureKey);
                    else _secureFeatures.TryRemove(featureDefinition.FeatureKey);
                    _definitions.AddOrUpdate(featureDefinition.FeatureKey, newDefinition, (name, def) => def = newDefinition);
                    _featureStateService.UpdateFeatureState(featureDefinition.FeatureKey, newDefinition.EnabledFor.Any(s => s.Name == "AlwaysOn"));
                }
                var activeExperiments = newDefinitions.Where(t => t.Metrics != null).SelectMany(t => t.Metrics!).GroupBy(t => t).Select(t => t.Key).ToList();
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
                            try
                            {
                                _webSocketClient = new WebsocketClient(liveConnectionUri) { ReconnectTimeout = null };
                                _webSocketClient.MessageReceived.Subscribe(msg =>
                                {
                                    if (msg.Text == "update") _ = RefreshFeatures(new TimeSpan(0, 0, 10).Ticks).ConfigureAwait(false);
                                });
                                _webSocketClient.DisconnectionHappened.Subscribe(info =>
                                {
                                    _logger.LogWarning("Websocket disconnected");
                                });
                                _webSocketClient.ErrorReconnectTimeout = new TimeSpan(0, 0, 5);

                                await _webSocketClient.StartOrFail().ConfigureAwait(false);
                            }
                            catch
                            {
                                //Websocket not available, continue without it
                            }
                        }
                    }
                }

                _lastRefresh = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error refreshing features list");
                _lastError = ex.Message;
                _lastErrorTime = DateTime.UtcNow;
            }
        }

        private async Task<ECDsa?> GetEcdsaKey(string keyId)
        {
            // Check if key ID is in whitelist if one is configured
            if (_settings.Value.AllowedKeyIds != null && !_settings.Value.AllowedKeyIds.Contains(keyId))
            {
                _logger.LogError("Key ID {KeyId} not in allowed list", keyId);
                return null;
            }

            // Check if we have a valid cached key
            if (_ecDsaKeys.TryGetValue(keyId, out var cachedKey))
            {
                if (cachedKey.Expiry > DateTime.UtcNow)
                    return cachedKey.Key;
                
                // Remove expired key
                _ecDsaKeys.TryRemove(keyId, out _);
            }

            if (_snapshotProvider != null)
            {
                var jwkSnapshot = await _snapshotProvider.GetJwkSnapshotAsync(CancellationToken.None).ConfigureAwait(false);
                if (jwkSnapshot.Jwks != null)
                {
                    foreach (var key in jwkSnapshot.Jwks.Keys)
                    {
                        // Verify key ID for each key
                        byte[] xCoord = Convert.FromBase64String(key.X.Replace('-', '+').Replace('_', '/') + new string('=', (4 - key.X.Length % 4) % 4));
                        byte[] yCoord = Convert.FromBase64String(key.Y.Replace('-', '+').Replace('_', '/') + new string('=', (4 - key.Y.Length % 4) % 4));
                        
                        var kidInput = xCoord.Concat(yCoord).ToArray();
                        string computedKid;
                        using (var sha1 = SHA1.Create())
                        {
                            var hash = sha1.ComputeHash(kidInput);
                            computedKid = BitConverter.ToString(hash).Replace("-", "") + "ES256";
                        }

                        if (key.Kid != computedKid)
                        {
                            _logger.LogError("Invalid key ID in JWKS. Expected: {ExpectedKid}, Got: {ActualKid}", computedKid, key.Kid);
                            continue;
                        }

                        // If this is the key we're looking for and it's valid
                        if (key.Kid == keyId && key.Alg == "ES256")
                        {
                            _logger.LogDebug("Using JWK: {@Key}", key);
                            _logger.LogDebug("X coordinate (hex): {X}", BitConverter.ToString(xCoord).Replace("-", ""));
                            _logger.LogDebug("Y coordinate (hex): {Y}", BitConverter.ToString(yCoord).Replace("-", ""));

                            var ecdsa = ECDsa.Create();
                            var ecParameters = new ECParameters
                            {
                                Curve = ECCurve.NamedCurves.nistP256,
                                Q = new ECPoint
                                {
                                    X = xCoord,
                                    Y = yCoord
                                }
                            };

                            ecdsa.ImportParameters(ecParameters);
                            _ecDsaKeys.TryAdd(keyId, (ecdsa, DateTime.UtcNow.AddDays(30)));
                            return ecdsa;
                        }
                    }
                }
            }

            using var httpClient = _clientFactory.CreateClient("toggly");
#if NETCOREAPP3_1_OR_GREATER
            httpClient.DefaultRequestVersion = HttpVersion.Version20;
#endif
            httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("Toggly.FeatureManagement", Version));
                    
            // Fetch JWKS
            var jwksResponse = await httpClient.GetAsync(".well-known/jwks").ConfigureAwait(false);
            jwksResponse.EnsureSuccessStatusCode();
            var jwks = await jwksResponse.Content.ReadFromJsonAsync<JsonWebKeySet>().ConfigureAwait(false);
            if (jwks == null)
            {
                _logger.LogError("Received empty JWKS from toggly");
                return null;
            }
            if (_snapshotProvider != null)
                await _snapshotProvider.SaveJwkSnapshot(jwks, ((DateTimeOffset)DateTime.UtcNow.AddDays(30)).ToUnixTimeSeconds(), CancellationToken.None).ConfigureAwait(false);
            
            foreach (var key in jwks!.Keys)
            {
                // Verify key ID for each key
                byte[] xCoord = Convert.FromBase64String(key.X.Replace('-', '+').Replace('_', '/') + new string('=', (4 - key.X.Length % 4) % 4));
                byte[] yCoord = Convert.FromBase64String(key.Y.Replace('-', '+').Replace('_', '/') + new string('=', (4 - key.Y.Length % 4) % 4));
                
                var kidInput = xCoord.Concat(yCoord).ToArray();
                string computedKid;
                using (var sha1 = SHA1.Create())
                {
                    var hash = sha1.ComputeHash(kidInput);
                    computedKid = BitConverter.ToString(hash).Replace("-", "") + "ES256";
                }

                if (key.Kid != computedKid)
                {
                    _logger.LogError("Invalid key ID in JWKS. Expected: {ExpectedKid}, Got: {ActualKid}", computedKid, key.Kid);
                    continue;
                }

                // If this is the key we're looking for and it's valid
                if (key.Kid == keyId && key.Alg == "ES256")
                {
                    _logger.LogDebug("Using JWK: {@Key}", key);
                    _logger.LogDebug("X coordinate (hex): {X}", BitConverter.ToString(xCoord).Replace("-", ""));
                    _logger.LogDebug("Y coordinate (hex): {Y}", BitConverter.ToString(yCoord).Replace("-", ""));

                    var ecdsa = ECDsa.Create();
                    var ecParameters = new ECParameters
                    {
                        Curve = ECCurve.NamedCurves.nistP256,
                        Q = new ECPoint
                        {
                            X = xCoord,
                            Y = yCoord
                        }
                    };

                    ecdsa.ImportParameters(ecParameters);
                    _ecDsaKeys.TryAdd(keyId, (ecdsa, DateTime.UtcNow.AddDays(30)));
                    return ecdsa;
                }
            }

            _logger.LogError("No valid matching ES256 key found in JWKS for key ID: {KeyId}", keyId);
            return null;
        }

        /// <summary>
        /// Get all feature definitions
        /// </summary>
        /// <returns></returns>
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

        /// <summary>
        /// Get a feature definition by name
        /// </summary>
        /// <param name="featureName"></param>
        /// <returns></returns>
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
            
            return new FeatureDefinition { Name = featureName, EnabledFor = _enabledByDefault ? new List<FeatureFilterConfiguration> { new FeatureFilterConfiguration { Name = "AlwaysOn" } } : new List<FeatureFilterConfiguration>() };
        }

        /// <summary>
        /// Dispose the feature provider
        /// </summary>
        public void Dispose()
        {
            _timer.Dispose();
        }

        /// <summary>
        /// Get features related to a metric for an experiment
        /// </summary>
        /// <param name="metricKey"></param>
        /// <returns></returns>
        public List<string>? GetFeaturesForMetric(string metricKey)
        {
            if (_experiments.TryGetValue(metricKey, out var features))
                return features.ToList();
            
            return null;
        }

        /// <summary>
        /// Get debug information
        /// </summary>
        /// <returns></returns>
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
        
        /// <summary>
        /// Check if a feature requires a security check
        /// </summary>
        /// <param name="featureKey">Feature key</param>
        /// <returns>True if the feature requires a security check</returns>
        public bool IsFeatureSecured(string featureKey) => _secureFeatures.Contains(featureKey);
    }
}
