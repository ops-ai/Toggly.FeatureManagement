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
using System.Text.Json.Serialization;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Data;
using TogglyVariantDefinition = Toggly.FeatureManagement.Data.VariantDefinition;
using Websocket.Client;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Toggly feature provider
    /// </summary>
    public class TogglyFeatureProvider : IFeatureDefinitionProvider, IDisposable, IFeatureExperimentProvider, IFeatureProviderDebug, ISecureFeatureProvider
    {
        private readonly string _appKey;

        private readonly string _environment;

        private string SanitizedAppKey => _appKey.Length > 6 ? $"***{_appKey[^6..]}" : "***";

        private volatile EntityTagHeaderValue? _lastETag = null;

        private readonly ConcurrentDictionary<string, FeatureDefinition> _definitions = new ConcurrentDictionary<string, FeatureDefinition>();

        private readonly ILogger _logger;

        private readonly IHttpClientFactory _clientFactory;

        private readonly IFeatureSnapshotProvider? _snapshotProvider;

        private volatile bool _loaded = false;

        private readonly Timer _timer;
        private readonly TimeSpan _refreshInterval = new TimeSpan(0, 5, 0);
        private volatile bool _webSocketConnected = false;

        private readonly string Version;

        private readonly ConcurrentDictionary<string, ConcurrentHashSet<string>> _experiments = new ConcurrentDictionary<string, ConcurrentHashSet<string>>();

        private volatile WebsocketClient? _webSocketClient = null;
        private readonly object _webSocketLock = new object();
        private Timer? _wsPingTimer = null;

        private readonly IFeatureStateInternalService _featureStateService;

        private readonly IServiceProvider _serviceProvider;

        private readonly bool _enabledByDefault;

        private readonly bool _useSignedDefinitions;

        private readonly ConcurrentHashSet<string> _secureFeatures = new ConcurrentHashSet<string>();

        private readonly ConcurrentDictionary<string, (ECDsa Key, DateTime Expiry)> _ecDsaKeys = new ConcurrentDictionary<string, (ECDsa Key, DateTime Expiry)>();

        private readonly IOptions<TogglySettings> _settings;

        private long _lastDefinitionsTimestamp;
        private readonly SemaphoreSlim _refreshSemaphore = new SemaphoreSlim(1, 1);
        private readonly SemaphoreSlim _loadSemaphore = new SemaphoreSlim(1, 1);
        
        private IMetricsService? _metricsService = null;
        private readonly object _metricsServiceLock = new object();

        /// <summary>Newtonsoft settings aligned with Toggly Web definitions signing (camelCase, dictionary keys unchanged).</summary>
        private static readonly JsonSerializerSettings SignedDefinitionsSerializerSettings = new JsonSerializerSettings
        {
            ContractResolver = new CamelCasePropertyNamesContractResolver
            {
                NamingStrategy = new CamelCaseNamingStrategy { ProcessDictionaryKeys = false }
            },
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            Converters = { new Newtonsoft.Json.Converters.StringEnumConverter() },
            Formatting = Formatting.None
        };

        /// <summary>
        /// JWKS and similar responses use lowercase RFC JSON names; STJ defaults are case-sensitive.
        /// </summary>
        private static readonly JsonSerializerOptions SystemJsonCaseInsensitive = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        };

        /// <summary>
        /// Hash payload the same way as <c>Toggly.Definitions</c> <c>signES256</c>: UTF-8 bytes are
        /// SHA-256 digested, then Web Crypto <c>subtle.sign(ECDSA, SHA-256, …)</c> digests that
        /// digest again before ECDSA. Matches <c>toggly-go/toggly/crypto/verify.go</c>.
        /// </summary>
        private static byte[] ComputeSignedDefinitionsPayloadHash(string dataToVerify)
        {
            var dataBytes = Encoding.UTF8.GetBytes(dataToVerify);
            using (var sha256 = SHA256.Create())
            {
                var firstDigest = sha256.ComputeHash(dataBytes);
                return sha256.ComputeHash(firstDigest);
            }
        }

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

            Version = $"{Assembly.GetAssembly(typeof(TogglyFeatureProvider))?.GetCustomAttribute<AssemblyVersionAttribute>()?.Version}";

            var definitionsUrl = togglySettings.Value.DefinitionsBaseUrl ?? "https://definitions.toggly.io/";
            var definitionsPath = _useSignedDefinitions ? "definitions-signed" : "definitions";

            if (string.IsNullOrWhiteSpace(_appKey))
                _logger.LogError("Toggly AppKey is not configured. Feature flags will not work. Set the AppKey in your Toggly configuration");
            else if (string.IsNullOrWhiteSpace(_environment))
                _logger.LogError("Toggly Environment is not configured. Feature flags will not work. Set the Environment in your Toggly configuration");
            else
                _logger.LogInformation("Toggly initialized — DefinitionsUrl: {DefinitionsUrl}{DefinitionsPath}/{AppKey}/{Environment}, Signed: {UseSigned}",
                    definitionsUrl, definitionsPath, SanitizedAppKey, _environment, _useSignedDefinitions);

            _timer = new Timer(TimerCallback, null, TimeSpan.Zero, _refreshInterval);
        }

        private void TimerCallback(object? state)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    if (_webSocketConnected)
                        return;

                    await RefreshFeatures(_refreshInterval.Ticks).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error in timer callback while refreshing features");
                }
            });
        }

        private async Task LoadSnapshot()
        {
            try
            {
                if (_snapshotProvider == null)
                    return;

                var snapshot = await _snapshotProvider.GetFeaturesSnapshotAsync().ConfigureAwait(false);
                if (snapshot == null)
                    return;

                List<FeatureDefinitionModel>? featuresToApply = snapshot.Features;

                if (_useSignedDefinitions)
                {
                    if (snapshot.Signature == null || snapshot.KeyId == null || snapshot.Timestamp == null)
                    {
                        ReportError("Snapshot is missing required signature fields");
                        return;
                    }

                    var signature = Convert.FromBase64String(snapshot.Signature);
                    var ecdsa = await GetEcdsaKey(snapshot.KeyId).ConfigureAwait(false);
                    if (ecdsa == null)
                    {
                        ReportError("No ES256 key found in JWKS");
                        return;
                    }

                    if (!string.IsNullOrEmpty(snapshot.SignedDefsJson))
                    {
                        // Verify against the exact server-signed defs JSON (never re-serialize).
                        var dataToVerify = $"{snapshot.SignedDefsJson}|{snapshot.Timestamp}";
                        var hash = ComputeSignedDefinitionsPayloadHash(dataToVerify);
                        if (!ecdsa.VerifyHash(hash, signature))
                        {
                            ReportError("Invalid signature");
                            return;
                        }

                        var verifiedFeatures = System.Text.Json.JsonSerializer.Deserialize<List<FeatureDefinitionModel>>(
                            snapshot.SignedDefsJson, SystemJsonCaseInsensitive);
                        if (verifiedFeatures == null)
                        {
                            ReportError("Failed to deserialize SignedDefsJson after signature verification");
                            return;
                        }

                        // Typed Features are not independently trusted. If present they must match
                        // the verified SignedDefsJson; any divergence means storage was tampered with.
                        if (snapshot.Features != null &&
                            !FeatureListsMatchForIntegrity(snapshot.Features, verifiedFeatures))
                        {
                            ReportError(
                                "Snapshot Features do not match verified SignedDefsJson; refusing to load (possible storage tampering)");
                            return;
                        }

                        featuresToApply = verifiedFeatures;
                    }
                    else if (featuresToApply != null)
                    {
                        // Legacy snapshot without raw defs — soft-load typed features once.
                        // The ongoing RefreshFeatures HTTP path upgrades the snapshot with SignedDefsJson.
                        ReportError(
                            "Snapshot is missing SignedDefsJson; loaded without cryptographic re-verification. Clear and refresh to upgrade the snapshot.",
                            level: LogLevel.Warning);
                    }
                    else
                    {
                        ReportError("Snapshot is missing SignedDefsJson and Features");
                        return;
                    }
                }

                if (featuresToApply == null)
                    return;

                if (!string.IsNullOrEmpty(snapshot.ETag))
                    _lastETag = TryParseEntityTag(snapshot.ETag);
                if (snapshot.Timestamp.HasValue)
                    Interlocked.Exchange(ref _lastDefinitionsTimestamp, snapshot.Timestamp.Value);

                ApplyNewDefinitions(featuresToApply);
            }
            catch (Exception ex)
            {
                ReportError("Error loading from snapshot", ex);
            }
        }

        private const string DefinitionsRevisionHeader = "X-Definitions-Revision";

        private void ReportError(string message, Exception? ex = null, LogLevel level = LogLevel.Error)
        {
            _lastError = message;
            _lastErrorTime = DateTime.UtcNow;
            if (ex != null)
                _logger.Log(level, ex, "{ErrorMessage}", message);
            else
                _logger.Log(level, "{ErrorMessage}", message);

            try
            {
                _settings.Value.OnError?.Invoke(message, ex);
            }
            catch (Exception callbackEx)
            {
                _logger.LogWarning(callbackEx, "OnError callback threw");
            }
        }

        private static EntityTagHeaderValue? TryParseEntityTag(string? revision)
        {
            if (string.IsNullOrWhiteSpace(revision))
                return null;

            var trimmed = revision.Trim();
            if (!trimmed.StartsWith("\"", StringComparison.Ordinal))
                trimmed = $"\"{trimmed.Trim('"')}\"";

            return EntityTagHeaderValue.TryParse(trimmed, out var etag) ? etag : null;
        }

        private string? ReadDefinitionsRevision(HttpResponseMessage response)
        {
            if (response.Headers.ETag != null)
                return response.Headers.ETag.Tag.Trim('"');

            if (response.Headers.TryGetValues("ETag", out var etagValues))
            {
                var raw = etagValues.FirstOrDefault();
                if (!string.IsNullOrWhiteSpace(raw))
                    return raw.Trim().Trim('"');
            }

            if (response.Headers.TryGetValues(DefinitionsRevisionHeader, out var revValues))
            {
                var raw = revValues.FirstOrDefault();
                if (!string.IsNullOrWhiteSpace(raw))
                    return raw.Trim().Trim('"');
            }

            return null;
        }

        private void StoreDefinitionsRevision(string? revision)
        {
            if (string.IsNullOrWhiteSpace(revision))
            {
                _logger.LogWarning("Response did not include ETag or {Header} header", DefinitionsRevisionHeader);
                return;
            }

            _lastETag = TryParseEntityTag(revision);
            _logger.LogDebug("Received and stored definitions revision: {Revision}", revision);
        }

        private void ClearCachedJwks()
        {
            foreach (var key in _ecDsaKeys.Keys)
                _ecDsaKeys.TryRemove(key, out _);
        }

        /// <summary>
        /// Clears persisted feature and JWKS snapshots (when a snapshot provider is configured).
        /// Does not clear in-memory definitions; call after a successful refresh to rebuild cache,
        /// or before restart when recovering from a corrupt snapshot.
        /// </summary>
        public async Task ClearPersistedSnapshotsAsync(CancellationToken ct = default)
        {
            if (_snapshotProvider == null)
                return;

            await _snapshotProvider.ClearSnapshotAsync(ct).ConfigureAwait(false);
            await _snapshotProvider.ClearJwkSnapshotAsync(ct).ConfigureAwait(false);
            ClearCachedJwks();
        }


        private string _lastError = string.Empty;
        private DateTime? _lastErrorTime = null;
        private DateTime? _lastRefresh = null;
        private DateTime? _lastDefinitionsCheck = null;
        
        private async Task RefreshFeatures(long? timeout = null)
        {
            // Prevent concurrent refresh operations (timer and WebSocket could overlap)
            if (!await _refreshSemaphore.WaitAsync(0).ConfigureAwait(false))
            {
                _logger.LogDebug("Refresh already in progress, skipping");
                return;
            }

            HttpClient? httpClient = null;
            try
            {
                // Ensure initial load happens only once (singleton, but multiple threads could call this)
                if (!_loaded)
                {
                    await _loadSemaphore.WaitAsync().ConfigureAwait(false);
                    try
                    {
                        if (!_loaded)
                        {
                            await LoadSnapshot().ConfigureAwait(false);
                            _loaded = true;
                        }
                    }
                    finally
                    {
                        try
                        {
                            _loadSemaphore.Release();
                        }
                        catch (ObjectDisposedException)
                        {
                            // Semaphore was disposed during execution, ignore
                        }
                    }
                }

                // Thread-safe lazy initialization of metrics service
                if (_metricsService == null)
                {
                    lock (_metricsServiceLock)
                    {
                        _metricsService ??= _serviceProvider.GetService<IMetricsService>();
                    }
                }

                httpClient = _clientFactory.CreateClient("toggly");
#if NETCOREAPP3_1_OR_GREATER
                httpClient.DefaultRequestVersion = HttpVersion.Version20;
#endif
                httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("toggly-dotnet", Version));
                if (timeout.HasValue)
                    httpClient.Timeout = new TimeSpan(timeout.Value);
                
                var currentETag = _lastETag;
                if (currentETag != null)
                {
                    // Clear any existing If-None-Match headers and add our ETag
                    httpClient.DefaultRequestHeaders.IfNoneMatch.Clear();
                    httpClient.DefaultRequestHeaders.IfNoneMatch.Add(currentETag);
                    _logger.LogDebug("Sending If-None-Match header: {ETag}", currentETag);
                }
                else
                {
                    _logger.LogDebug("No ETag available, making full request");
                }

                List<FeatureDefinitionModel>? newDefinitions;
                if (_useSignedDefinitions)
                {
                    var requestPath = $"definitions-signed/{_appKey}/{_environment}";
                    var newDefinitionsRequest = await httpClient.GetAsync(requestPath).ConfigureAwait(false);
                    if (newDefinitionsRequest.StatusCode == HttpStatusCode.NotModified)
                    {
                        _lastDefinitionsCheck = DateTime.UtcNow;
                        return;
                    }

                    if (!newDefinitionsRequest.IsSuccessStatusCode)
                    {
                        await HandleDefinitionsRequestError(newDefinitionsRequest, requestPath).ConfigureAwait(false);
                        return;
                    }

                    // Get the raw JSON string first
                    var rawJson = await newDefinitionsRequest.Content.ReadAsStringAsync().ConfigureAwait(false);
                    var signedDefinitionsResponse = System.Text.Json.JsonSerializer.Deserialize<SignedDefinitionsResponse>(rawJson, SystemJsonCaseInsensitive);
                    if (signedDefinitionsResponse == null)
                    {
                        _logger.LogWarning("Received empty response from toggly");
                        return;
                    }

                    if (signedDefinitionsResponse.Defs == null)
                    {
                        ReportError("Signed definitions response missing defs", level: LogLevel.Warning);
                        return;
                    }

                    if (string.IsNullOrEmpty(signedDefinitionsResponse.Signature))
                    {
                        ReportError("Signed definitions response missing signature", level: LogLevel.Warning);
                        return;
                    }

                    if (string.IsNullOrEmpty(signedDefinitionsResponse.Kid))
                    {
                        ReportError("Signed definitions response missing kid", level: LogLevel.Warning);
                        return;
                    }

                    // Check timestamp (thread-safe read)
                    var currentTimestamp = Interlocked.Read(ref _lastDefinitionsTimestamp);
                    if (signedDefinitionsResponse.Timestamp < currentTimestamp)
                    {
                        ReportError(
                            $"Received definitions with older timestamp. Current: {currentTimestamp}, Received: {signedDefinitionsResponse.Timestamp}",
                            level: LogLevel.Warning);
                        return;
                    }

                    // Extract the raw data portion from the JSON
                    string rawData;
                    using (var jsonDoc = JsonDocument.Parse(rawJson))
                    {
                        if (!jsonDoc.RootElement.TryGetProperty("defs", out var dataElement))
                        {
                            ReportError("Signed definitions response missing defs property");
                            return;
                        }

                        rawData = dataElement.GetRawText();
                    }

                    var dataToVerify = $"{rawData}|{signedDefinitionsResponse.Timestamp}";
                    _logger.LogDebug(
                        "Verifying signed definitions payload length {Length}, timestamp {Timestamp}",
                        rawData.Length, signedDefinitionsResponse.Timestamp);

                    var hash = ComputeSignedDefinitionsPayloadHash(dataToVerify);

                    var signature = Convert.FromBase64String(signedDefinitionsResponse.Signature);

                    var ecdsa = await GetEcdsaKey(signedDefinitionsResponse.Kid).ConfigureAwait(false);
                    if (ecdsa == null)
                    {
                        ReportError("No ES256 key found in JWKS");
                        return;
                    }

                    if (!ecdsa.VerifyHash(hash, signature))
                    {
                        ReportError("Invalid signature");
                        return;
                    }

                    // Prefer verified raw defs for evaluation and persistence (same bytes that were signed).
                    newDefinitions = System.Text.Json.JsonSerializer.Deserialize<List<FeatureDefinitionModel>>(
                        rawData, SystemJsonCaseInsensitive) ?? signedDefinitionsResponse.Defs;
                    var revision = ReadDefinitionsRevision(newDefinitionsRequest);
                    StoreDefinitionsRevision(revision);
                    Interlocked.Exchange(ref _lastDefinitionsTimestamp, signedDefinitionsResponse.Timestamp);

                    if (_snapshotProvider != null)
                        await _snapshotProvider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot
                        {
                            // Always persist Features derived from verified SignedDefsJson — never a
                            // separately mutable typed copy that could diverge in storage.
                            Features = newDefinitions,
                            Signature = signedDefinitionsResponse.Signature,
                            KeyId = signedDefinitionsResponse.Kid,
                            Timestamp = signedDefinitionsResponse.Timestamp,
                            SignedDefsJson = rawData,
                            ETag = revision
                        }).ConfigureAwait(false);
                }
                else
                {
                    var requestPath = $"definitions/{_appKey}/{_environment}";
                    var newDefinitionsRequest = await httpClient.GetAsync(requestPath).ConfigureAwait(false);
                    if (newDefinitionsRequest.StatusCode == HttpStatusCode.NotModified)
                    {
                        _lastDefinitionsCheck = DateTime.UtcNow;
                        return;
                    }

                    if (!newDefinitionsRequest.IsSuccessStatusCode)
                    {
                        await HandleDefinitionsRequestError(newDefinitionsRequest, requestPath).ConfigureAwait(false);
                        return;
                    }

                    newDefinitions = await newDefinitionsRequest.Content.ReadFromJsonAsync<List<FeatureDefinitionModel>>().ConfigureAwait(false);
                    if (newDefinitions == null)
                    {
                        _logger.LogWarning("Received empty response from toggly");
                        return;
                    }

                    var revision = ReadDefinitionsRevision(newDefinitionsRequest);
                    StoreDefinitionsRevision(revision);
                    if (_snapshotProvider != null)
                        await _snapshotProvider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot
                        {
                            Features = newDefinitions,
                            ETag = revision
                        }).ConfigureAwait(false);
                }

                ApplyNewDefinitions(newDefinitions);
                
                _loaded = true;
                
                // Thread-safe websocket client check and initialization
                var shouldInitializeWebSocket = false;
                lock (_webSocketLock)
                {
                    if (_webSocketClient == null || !_webSocketClient.IsRunning)
                    {
                        shouldInitializeWebSocket = true;
                    }
                }
                
                if (shouldInitializeWebSocket)
                {
                    try
                    {
                        var baseUri = new Uri(_settings.Value.DefinitionsBaseUrl ?? "https://definitions.toggly.io/");
                        var wsBuilder = new UriBuilder(new Uri(baseUri, $"{_appKey}/{_environment}/ws"))
                        {
                            Scheme = baseUri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws",
                            Port = baseUri.IsDefaultPort ? -1 : baseUri.Port
                        };
                        var queryParts = new List<string>
                        {
                            "sdk=dotnet",
                            $"sdkVersion={Uri.EscapeDataString(Version)}"
                        };
                        if (_lastETag != null)
                        {
                            queryParts.Insert(0, $"rev={Uri.EscapeDataString(_lastETag.Tag.Trim('"'))}");
                        }
                        wsBuilder.Query = string.Join("&", queryParts);
                        var liveConnectionUri = wsBuilder.Uri;

                        var newWebSocketClient = new WebsocketClient(liveConnectionUri) { ReconnectTimeout = null };
                        newWebSocketClient.MessageReceived.Subscribe(msg =>
                        {
                            if (string.IsNullOrEmpty(msg.Text)) return;

                            var text = msg.Text.Trim();

                            if (text == "pong") return;

                            if (text == "update" || text == "flags-updated")
                            {
                                TriggerHttpRefresh();
                                return;
                            }

                            if (!text.StartsWith("{")) return;

                            try
                            {
                                using var doc = JsonDocument.Parse(text);
                                if (!doc.RootElement.TryGetProperty("type", out var typeProp)) return;
                                var type = typeProp.GetString();

                                if (type == "signing-key-updated")
                                {
                                    ClearCachedJwks();
                                    var snapshotProvider = _snapshotProvider;
                                    // Clear JWKS snapshot before refresh so the refresh cannot
                                    // race with ClearJwkSnapshotAsync deleting a newly saved JWKS.
                                    _ = Task.Run(async () =>
                                    {
                                        try
                                        {
                                            if (snapshotProvider != null)
                                                await snapshotProvider.ClearJwkSnapshotAsync().ConfigureAwait(false);
                                            await RefreshFeatures(new TimeSpan(0, 0, 10).Ticks).ConfigureAwait(false);
                                        }
                                        catch (Exception clearEx)
                                        {
                                            ReportError("Failed to process signing-key-updated", clearEx);
                                        }
                                    });
                                    return;
                                }

                                if (type == "definitions" && !_useSignedDefinitions
                                    && doc.RootElement.TryGetProperty("data", out var dataElement))
                                {
                                    var definitions = System.Text.Json.JsonSerializer.Deserialize<List<FeatureDefinitionModel>>(
                                        dataElement.GetRawText(),
                                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                                    if (definitions != null)
                                    {
                                        ApplyNewDefinitions(definitions);
                                        _loaded = true;
                                        _lastRefresh = DateTime.UtcNow;
                                        _lastDefinitionsCheck = DateTime.UtcNow;
                                        _logger.LogDebug("Applied definitions directly from WebSocket message");
                                    }
                                }
                                else if (type == "update" || type == "flags-updated" || type == "definitions")
                                {
                                    TriggerHttpRefresh();
                                }
                            }
                            catch
                            {
                                // Not valid JSON — ignore
                            }
                        });
                        newWebSocketClient.DisconnectionHappened.Subscribe(info =>
                        {
                            _webSocketConnected = false;
                            _logger.LogWarning("Websocket disconnected: {Reason}", info.Type);
                        });
                        newWebSocketClient.ReconnectionHappened.Subscribe(_ =>
                        {
                            _webSocketConnected = true;
                        });
                        newWebSocketClient.ErrorReconnectTimeout = new TimeSpan(0, 0, 5);

                        var wsConnectTask = newWebSocketClient.StartOrFail();
                        var completed = await Task.WhenAny(wsConnectTask, Task.Delay(TimeSpan.FromSeconds(10))).ConfigureAwait(false);
                        if (completed != wsConnectTask)
                        {
                            _logger.LogWarning("WebSocket connection timed out after 10 seconds — disposing client");
                            try { newWebSocketClient.Dispose(); } catch { /* best-effort cleanup */ }
                            throw new TimeoutException("WebSocket connection timed out after 10 seconds");
                        }
                        await wsConnectTask.ConfigureAwait(false); // propagate any exception
                        _webSocketConnected = true;

                        // Only assign if successfully started
                        lock (_webSocketLock)
                        {
                            _webSocketClient?.Dispose();
                            _webSocketClient = newWebSocketClient;
                        }

                        // Send text "ping" every 30s to keep the connection alive through proxies/NATs.
                        // The DO's setWebSocketAutoResponse auto-replies "pong" without waking from hibernation.
                        _wsPingTimer?.Dispose();
                        _wsPingTimer = new Timer(_ =>
                        {
                            try
                            {
                                lock (_webSocketLock)
                                {
                                    if (_webSocketClient?.IsRunning == true)
                                        _webSocketClient.Send("ping");
                                }
                            }
                            catch { /* connection may be closed — will reconnect */ }
                        }, null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Websocket not available, continuing without it");
                    }
                }

                _lastRefresh = DateTime.UtcNow;
                _lastDefinitionsCheck = DateTime.UtcNow;
            }
            catch (HttpRequestException ex)
            {
                ReportError(
                    $"HTTP error refreshing feature definitions from {httpClient?.BaseAddress} for AppKey={SanitizedAppKey}, Environment={_environment}. " +
                    "Verify your Toggly configuration: ensure the AppKey is a valid Backend-type key and the Environment name matches exactly",
                    ex);
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException)
            {
                ReportError(
                    $"Timeout refreshing feature definitions from {httpClient?.BaseAddress} for AppKey={SanitizedAppKey}, Environment={_environment}. " +
                    "The definitions service may be temporarily unavailable",
                    ex);
            }
            catch (Exception ex)
            {
                ReportError(
                    $"Unexpected error refreshing feature definitions for AppKey={SanitizedAppKey}, Environment={_environment}",
                    ex);
            }
            finally
            {
                try
                {
                    _refreshSemaphore.Release();
                }
                catch (ObjectDisposedException)
                {
                    // Semaphore was disposed during execution (e.g., during application shutdown), ignore
                }
            }
        }

        private void ApplyNewDefinitions(List<FeatureDefinitionModel> newDefinitions)
        {
            foreach (var featureDefinition in newDefinitions)
            {
                var newDefinition = BuildFeatureDefinition(featureDefinition);
                if (featureDefinition.SecuredFeature) _secureFeatures.Add(featureDefinition.FeatureKey);
                else _secureFeatures.TryRemove(featureDefinition.FeatureKey);
                _definitions.AddOrUpdate(featureDefinition.FeatureKey, newDefinition, (name, def) => def = newDefinition);
                _featureStateService.UpdateFeatureState(featureDefinition.FeatureKey, newDefinition.EnabledFor.Any(s => s.Name == "AlwaysOn"));
            }

            var activeExperiments = newDefinitions
                .Where(t => t.Metrics != null)
                .SelectMany(t => t.Metrics!)
                .Distinct()
                .ToList();

            var newExperiments = new Dictionary<string, ConcurrentHashSet<string>>();
            foreach (var activeExperiment in activeExperiments)
            {
                var featureKeys = newDefinitions
                    .Where(t => t.Metrics != null && t.Metrics.Contains(activeExperiment))
                    .Select(t => t.FeatureKey)
                    .ToList();
                newExperiments[activeExperiment] = new ConcurrentHashSet<string>(featureKeys);
            }

            _experiments.Clear();
            foreach (var kvp in newExperiments)
            {
                _experiments.TryAdd(kvp.Key, kvp.Value);
            }

            _featureStateService.NotifyDefinitionsChanged();
        }

        /// <summary>
        /// Integrity check: stored typed Features must describe the same flags as the
        /// cryptographically verified SignedDefsJson (keys, filters, secured, metrics).
        /// </summary>
        internal static bool FeatureListsMatchForIntegrity(
            List<FeatureDefinitionModel> stored,
            List<FeatureDefinitionModel> verified)
        {
            if (stored.Count != verified.Count)
                return false;

            static string FeatureFingerprint(FeatureDefinitionModel f)
            {
                var filters = (f.Filters ?? Enumerable.Empty<FeatureFilter>())
                    .Select(filter =>
                    {
                        var parameters = filter.Parameters == null
                            ? string.Empty
                            : string.Join(",", filter.Parameters.OrderBy(p => p.Key).Select(p => $"{p.Key}={p.Value}"));
                        return $"{filter.Name}:{parameters}";
                    })
                    .OrderBy(x => x, StringComparer.Ordinal);
                var metrics = (f.Metrics ?? Enumerable.Empty<string>())
                    .OrderBy(x => x, StringComparer.Ordinal);
                return string.Join("|",
                    f.FeatureKey,
                    f.SecuredFeature,
                    f.RequirementType,
                    string.Join(";", filters),
                    string.Join(",", metrics));
            }

            var storedFingerprints = stored.Select(FeatureFingerprint).OrderBy(x => x, StringComparer.Ordinal).ToList();
            var verifiedFingerprints = verified.Select(FeatureFingerprint).OrderBy(x => x, StringComparer.Ordinal).ToList();
            return storedFingerprints.SequenceEqual(verifiedFingerprints, StringComparer.Ordinal);
        }

        private void TriggerHttpRefresh()
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await RefreshFeatures(new TimeSpan(0, 0, 10).Ticks).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    ReportError("Error refreshing features from websocket notification", ex);
                }
            });
        }

        private async Task HandleDefinitionsRequestError(HttpResponseMessage response, string requestPath)
        {
            var statusCode = (int)response.StatusCode;
            var responseBody = string.Empty;
            try
            {
                responseBody = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
            catch
            {
                // Best effort — response body may not be readable
            }

            var rawUrl = $"{response.RequestMessage?.RequestUri ?? new Uri(requestPath, UriKind.RelativeOrAbsolute)}";
            var sanitizedUrl = rawUrl.Replace(_appKey, SanitizedAppKey);
            var message = response.StatusCode switch
            {
                HttpStatusCode.Forbidden =>
                    $"Access denied (403) fetching definitions from {sanitizedUrl}. " +
                    (responseBody.Contains("does not match", StringComparison.OrdinalIgnoreCase)
                        ? $"The Environment \"{_environment}\" does not match the environment mapped to your AppKey. Verify the Environment name is correct and matches the app key configuration in your Toggly dashboard."
                        : $"This usually means you are using a Frontend/Mobile app key with the .NET SDK. The .NET SDK requires a Backend-type app key. " +
                          "Check your AppKey type in the Toggly dashboard under App Settings > App Keys.") +
                    (!string.IsNullOrEmpty(responseBody) ? $" Server response: {responseBody}" : string.Empty),

                HttpStatusCode.NotFound =>
                    $"Definitions not found (404) at {sanitizedUrl}. " +
                    $"Verify that AppKey \"{SanitizedAppKey}\" exists and Environment \"{_environment}\" is correct. " +
                    "Check your app key in the Toggly dashboard under App Settings > App Keys." +
                    (!string.IsNullOrEmpty(responseBody) ? $" Server response: {responseBody}" : string.Empty),

                HttpStatusCode.Unauthorized =>
                    $"Authentication failed (401) fetching definitions from {sanitizedUrl}. " +
                    "Verify your AppKey is valid and has not been revoked." +
                    (!string.IsNullOrEmpty(responseBody) ? $" Server response: {responseBody}" : string.Empty),

                HttpStatusCode.BadRequest =>
                    $"Bad request (400) fetching definitions from {sanitizedUrl}. " +
                    (!string.IsNullOrEmpty(responseBody) ? $"Server response: {responseBody}" : "The request was malformed."),

                _ =>
                    $"HTTP {statusCode} ({response.StatusCode}) fetching definitions from {sanitizedUrl} " +
                    $"for AppKey={SanitizedAppKey}, Environment={_environment}." +
                    (!string.IsNullOrEmpty(responseBody) ? $" Server response: {responseBody}" : string.Empty)
            };

            ReportError(message);
        }

        private static FeatureDefinition BuildFeatureDefinition(FeatureDefinitionModel featureDefinition)
        {
            return new FeatureDefinition
            {
                Name = featureDefinition.FeatureKey,
                EnabledFor = featureDefinition.Filters.Select(featureFilter =>
                    new FeatureFilterConfiguration
                    {
                        Name = featureFilter.Name,
                        Parameters = new ConfigurationBuilder().AddInMemoryCollection(featureFilter.Parameters?.Select(kvp => new KeyValuePair<string, string?>(kvp.Key, kvp.Value)) ?? Enumerable.Empty<KeyValuePair<string, string?>>()).Build()
                    }),
                RequirementType = featureDefinition.RequirementType,
                Variants = MapVariantsToMicrosoft(featureDefinition.Variants),
                Allocation = MapAllocationToMicrosoft(featureDefinition.Allocation)
            };
        }

        private static IEnumerable<Microsoft.FeatureManagement.VariantDefinition> MapVariantsToMicrosoft(IReadOnlyList<TogglyVariantDefinition>? variants)
        {
            if (variants == null || variants.Count == 0)
                return Enumerable.Empty<Microsoft.FeatureManagement.VariantDefinition>();

            return variants
                .Where(v => !string.IsNullOrEmpty(v.Name))
                .Select(v => new Microsoft.FeatureManagement.VariantDefinition
                {
                    Name = v.Name,
                    ConfigurationValue = BuildConfigurationSectionFromJson(v.ConfigurationValue),
                    StatusOverride = v.StatusOverride
                });
        }

        private static Allocation? MapAllocationToMicrosoft(AllocationDefinition? model)
        {
            if (model == null)
                return null;

            var hasUser = model.User != null && model.User.Count > 0;
            var hasGroup = model.Group != null && model.Group.Count > 0;
            var hasPercentile = model.Percentile != null && model.Percentile.Count > 0;
            if (model.DefaultWhenEnabled == null && model.DefaultWhenDisabled == null && model.Seed == null
                && !hasUser && !hasGroup && !hasPercentile)
                return null;

            return new Allocation
            {
                DefaultWhenEnabled = model.DefaultWhenEnabled,
                DefaultWhenDisabled = model.DefaultWhenDisabled,
                Seed = model.Seed,
                User = hasUser
                    ? model.User!
                        .Where(u => u != null && !string.IsNullOrEmpty(u.Variant))
                        .Select(u => new UserAllocation
                        {
                            Variant = u!.Variant!,
                            Users = u.Users ?? Enumerable.Empty<string>()
                        })
                    : Enumerable.Empty<UserAllocation>(),
                Group = hasGroup
                    ? model.Group!
                        .Where(g => g != null && !string.IsNullOrEmpty(g.Variant))
                        .Select(g => new GroupAllocation
                        {
                            Variant = g!.Variant!,
                            Groups = g.Groups ?? Enumerable.Empty<string>()
                        })
                    : Enumerable.Empty<GroupAllocation>(),
                Percentile = hasPercentile
                    ? model.Percentile!
                        .Where(p => p != null && !string.IsNullOrEmpty(p.Variant))
                        .Select(p => new PercentileAllocation
                        {
                            Variant = p!.Variant!,
                            From = p.From,
                            To = p.To
                        })
                    : Enumerable.Empty<PercentileAllocation>()
            };
        }

        private static IConfigurationSection? BuildConfigurationSectionFromJson(JsonElement configurationValue)
        {
            if (configurationValue.ValueKind == JsonValueKind.Undefined || configurationValue.ValueKind == JsonValueKind.Null)
                return null;

            if (configurationValue.ValueKind == JsonValueKind.Object && !configurationValue.EnumerateObject().Any())
                return null;

            const string rootKey = "v";
            var data = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
            if (configurationValue.ValueKind == JsonValueKind.Object || configurationValue.ValueKind == JsonValueKind.Array)
            {
                FlattenJsonElement(configurationValue, rootKey, data);
            }
            else
            {
                data[rootKey] = JsonElementToConfigString(configurationValue);
            }

            if (data.Count == 0)
                return null;

            var root = new ConfigurationBuilder().AddInMemoryCollection(data).Build();
            return root.GetSection(rootKey);
        }

        private static void FlattenJsonElement(JsonElement element, string prefix, IDictionary<string, string?> target)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Object:
                    foreach (var prop in element.EnumerateObject())
                    {
                        var key = string.IsNullOrEmpty(prefix) ? prop.Name : prefix + ConfigurationPath.KeyDelimiter + prop.Name;
                        FlattenJsonElement(prop.Value, key, target);
                    }
                    break;
                case JsonValueKind.Array:
                    var i = 0;
                    foreach (var item in element.EnumerateArray())
                    {
                        var key = prefix + ConfigurationPath.KeyDelimiter + i.ToString();
                        FlattenJsonElement(item, key, target);
                        i++;
                    }
                    break;
                case JsonValueKind.String:
                    target[prefix] = element.GetString();
                    break;
                case JsonValueKind.Number:
                    target[prefix] = element.GetRawText();
                    break;
                case JsonValueKind.True:
                    target[prefix] = "true";
                    break;
                case JsonValueKind.False:
                    target[prefix] = "false";
                    break;
                case JsonValueKind.Null:
                    target[prefix] = null;
                    break;
            }
        }

        private static string? JsonElementToConfigString(JsonElement element)
        {
            return element.ValueKind switch
            {
                JsonValueKind.String => element.GetString(),
                JsonValueKind.Number => element.GetRawText(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => element.GetRawText()
            };
        }

        private readonly ConcurrentDictionary<string, SemaphoreSlim> _keyFetchSemaphores = new ConcurrentDictionary<string, SemaphoreSlim>();
        
        private async Task<ECDsa?> GetEcdsaKey(string keyId)
        {
            // Check if key ID is in whitelist if one is configured
            if (_settings.Value.AllowedKeyIds != null && !_settings.Value.AllowedKeyIds.Contains(keyId))
            {
                _logger.LogError("Key ID {KeyId} not in allowed list", keyId);
                return null;
            }

            // Check if we have a valid cached key (double-check pattern)
            if (_ecDsaKeys.TryGetValue(keyId, out var cachedKey))
            {
                if (cachedKey.Expiry > DateTime.UtcNow)
                    return cachedKey.Key;
                
                // Remove expired key
                _ecDsaKeys.TryRemove(keyId, out _);
            }

            // Use per-key semaphore to prevent concurrent fetches of the same key
            // (defensive: even though RefreshFeatures is fast, network issues could cause delays)
            var keySemaphore = _keyFetchSemaphores.GetOrAdd(keyId, _ => new SemaphoreSlim(1, 1));
            await keySemaphore.WaitAsync().ConfigureAwait(false);
            
            try
            {
                // Double-check after acquiring lock (another thread might have fetched it)
                if (_ecDsaKeys.TryGetValue(keyId, out var recheckKey))
                {
                    if (recheckKey.Expiry > DateTime.UtcNow)
                        return recheckKey.Key;
                    
                    // Remove expired key
                    _ecDsaKeys.TryRemove(keyId, out _);
                }

                if (_snapshotProvider != null)
                {
                    var jwkSnapshot = await _snapshotProvider.GetJwkSnapshotAsync(CancellationToken.None).ConfigureAwait(false);
                    if (jwkSnapshot.Jwks != null)
                    {
                        foreach (var key in jwkSnapshot.Jwks.Keys ?? Enumerable.Empty<JsonWebKey>())
                        {
                            if (string.IsNullOrEmpty(key.X) || string.IsNullOrEmpty(key.Y) || string.IsNullOrEmpty(key.Kid) || string.IsNullOrEmpty(key.Alg))
                            {
                                _logger.LogWarning("Skipping JWK with missing coordinates or metadata");
                                continue;
                            }

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
                httpClient.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("toggly-dotnet", Version));
                        
                // Fetch JWKS
                var jwksResponse = await httpClient.GetAsync(".well-known/jwks").ConfigureAwait(false);
                if (!jwksResponse.IsSuccessStatusCode)
                {
                    var body = string.Empty;
                    try { body = await jwksResponse.Content.ReadAsStringAsync().ConfigureAwait(false); } catch { }
                    _logger.LogError("Failed to fetch JWKS from {Url}: HTTP {StatusCode}. {ResponseBody}",
                        jwksResponse.RequestMessage?.RequestUri, (int)jwksResponse.StatusCode, body);
                    return null;
                }
                var jwks = await jwksResponse.Content.ReadFromJsonAsync<JsonWebKeySet>(SystemJsonCaseInsensitive).ConfigureAwait(false);
                if (jwks == null)
                {
                    _logger.LogError("Received empty JWKS from toggly");
                    return null;
                }
                if (_snapshotProvider != null)
                    await _snapshotProvider.SaveJwkSnapshot(jwks, ((DateTimeOffset)DateTime.UtcNow.AddDays(30)).ToUnixTimeSeconds(), CancellationToken.None).ConfigureAwait(false);
                
                if (jwks.Keys == null || jwks.Keys.Count == 0)
                {
                    _logger.LogError("JWKS response contained no keys");
                    return null;
                }

                foreach (var key in jwks.Keys)
                {
                    if (string.IsNullOrEmpty(key.X) || string.IsNullOrEmpty(key.Y) || string.IsNullOrEmpty(key.Kid) || string.IsNullOrEmpty(key.Alg))
                    {
                        _logger.LogWarning("Skipping JWK with missing coordinates or metadata");
                        continue;
                    }

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
            finally
            {
                try
                {
                    keySemaphore.Release();
                }
                catch (ObjectDisposedException)
                {
                    // Semaphore was disposed during execution (e.g., during application shutdown), ignore
                }
            }
        }

        /// <summary>
        /// Get all feature definitions
        /// </summary>
        /// <returns></returns>
        public async IAsyncEnumerable<FeatureDefinition> GetAllFeatureDefinitionsAsync()
        {
            // Wait for initial load with timeout
            if (!_loaded)
            {
                var maxWaitTime = TimeSpan.FromSeconds(2.5); // 5 * 500ms
                var elapsed = TimeSpan.Zero;
                var delay = TimeSpan.FromMilliseconds(100);
                
                while (!_loaded && elapsed < maxWaitTime)
                {
                    await Task.Delay(delay).ConfigureAwait(false);
                    elapsed = elapsed.Add(delay);
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
            // Wait for initial load with timeout
            if (!_loaded)
            {
                var maxWaitTime = TimeSpan.FromSeconds(2.5); // 5 * 500ms
                var elapsed = TimeSpan.Zero;
                var delay = TimeSpan.FromMilliseconds(100);
                
                while (!_loaded && elapsed < maxWaitTime)
                {
                    await Task.Delay(delay).ConfigureAwait(false);
                    elapsed = elapsed.Add(delay);
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
            _timer?.Dispose();
            _wsPingTimer?.Dispose();
            
            lock (_webSocketLock)
            {
                _webSocketClient?.Dispose();
                _webSocketClient = null;
            }
            
            _refreshSemaphore?.Dispose();
            _loadSemaphore?.Dispose();
            
            // Dispose cached ECDsa keys
            foreach (var kvp in _ecDsaKeys)
            {
                kvp.Value.Key?.Dispose();
            }
            _ecDsaKeys.Clear();
            
            // Dispose key fetch semaphores
            foreach (var semaphore in _keyFetchSemaphores.Values)
            {
                semaphore?.Dispose();
            }
            _keyFetchSemaphores.Clear();
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
            // Minor race conditions acceptable for debug info (singleton, infrequent updates)
            return new FeatureProviderDebugInfo
            {
                AppKey = SanitizedAppKey,
                Environment = _environment,
                Definitions = _definitions,
                Experiments = _experiments,
                UserAgent = new ProductInfoHeaderValue("toggly-dotnet", Version).ToString(),
                LastError = _lastError,
                LastErrorTime = _lastErrorTime,
                LastRefresh = _lastRefresh,
                LastDefinitionsCheck = _lastDefinitionsCheck,
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
