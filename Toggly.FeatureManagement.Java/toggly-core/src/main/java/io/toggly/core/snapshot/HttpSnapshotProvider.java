package io.toggly.core.snapshot;

import io.toggly.core.SdkIdentity;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.crypto.Es256Verifier;
import io.toggly.core.crypto.JsonWebKey;
import io.toggly.core.crypto.JsonWebKeySet;
import io.toggly.core.exception.TogglyNetworkException;
import io.toggly.core.exception.TogglySignatureException;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureRequirement;
import io.toggly.core.model.MetricDefinition;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HTTP-based snapshot provider that fetches definitions from Toggly API.
 *
 * <p>Uses only JDK classes for zero external dependencies. When
 * {@code useSignedDefinitions} is enabled, verifies ES256 signatures against
 * JWKS before applying updates and re-verifies from raw defs JSON on cache load.</p>
 */
public final class HttpSnapshotProvider implements SnapshotProvider {

    private static final Logger LOGGER = Logger.getLogger(HttpSnapshotProvider.class.getName());
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    private static final long FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000L;
    private static final long WS_RECONNECT_DELAY = 5000L;
    private static final long JWKS_TTL_DAYS = 30;

    private final TogglyConfig config;
    private final String definitionsUrl;
    private final AtomicReference<FeatureSnapshot> currentSnapshot;
    private final AtomicReference<String> lastEtag;
    private final AtomicLong lastSignedTimestamp;
    private final AtomicReference<JsonWebKeySet> jwks;
    private final AtomicReference<Instant> jwksExpiry;
    private final ScheduledExecutorService scheduler;

    private java.net.http.WebSocket webSocket;
    private volatile boolean wsConnected = false;
    private volatile long lastFallbackRefresh = 0;

    /**
     * Creates an HTTP snapshot provider.
     *
     * @param config the Toggly configuration
     */
    public HttpSnapshotProvider(TogglyConfig config) {
        this.config = config;
        this.definitionsUrl = buildDefinitionsUrl(config);
        this.currentSnapshot = new AtomicReference<>(FeatureSnapshot.empty());
        this.lastEtag = new AtomicReference<>(null);
        this.lastSignedTimestamp = new AtomicLong(0);
        this.jwks = new AtomicReference<>(null);
        this.jwksExpiry = new AtomicReference<>(Instant.EPOCH);

        long intervalSeconds = config.getRefreshIntervalSeconds();
        boolean needsScheduler = intervalSeconds > 0 || config.isEnableLiveUpdates();
        if (needsScheduler) {
            this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "toggly-refresh");
                t.setDaemon(true);
                return t;
            });
            if (intervalSeconds > 0) {
                scheduler.scheduleWithFixedDelay(
                        this::refreshSilently,
                        intervalSeconds,
                        intervalSeconds,
                        TimeUnit.SECONDS);
            }
        } else {
            this.scheduler = null;
        }
    }

    private String buildDefinitionsUrl(TogglyConfig config) {
        String baseUrl = config.getBaseUrl();
        if (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }
        String env = config.getEnvironment();
        if (env == null || env.isEmpty()) {
            env = "Production";
        }
        String endpoint = config.isUseSignedDefinitions() ? "definitions-signed" : "definitions";
        return baseUrl + "/" + endpoint + "/" + config.getAppKey() + "/" + env;
    }

    @Override
    public FeatureSnapshot getSnapshot() {
        FeatureSnapshot snapshot = currentSnapshot.get();
        if (snapshot.isEmpty()) {
            return refresh();
        }
        return snapshot;
    }

    @Override
    public CompletableFuture<FeatureSnapshot> getSnapshotAsync() {
        FeatureSnapshot snapshot = currentSnapshot.get();
        if (snapshot.isEmpty()) {
            return refreshAsync();
        }
        return CompletableFuture.completedFuture(snapshot);
    }

    @Override
    public FeatureSnapshot refresh() {
        try {
            FeatureSnapshot newSnapshot = fetchDefinitions();
            if (newSnapshot != null) {
                applySnapshot(newSnapshot);

                if (config.isEnableLiveUpdates() && !wsConnected && webSocket == null) {
                    startWebSocket();
                }

                return newSnapshot;
            }
        } catch (TogglySignatureException e) {
            reportError("Invalid signature", e);
            LOGGER.log(Level.WARNING, "Signature verification failed", e);
        } catch (Exception e) {
            reportError("Failed to refresh definitions", e);
            LOGGER.log(Level.WARNING, "Failed to refresh definitions", e);
        }
        // Last-known-good: keep serving the previous snapshot on transient failures
        return currentSnapshot.get();
    }

    @Override
    public CompletableFuture<FeatureSnapshot> refreshAsync() {
        return CompletableFuture.supplyAsync(this::refresh);
    }

    /**
     * Applies a previously persisted snapshot, re-verifying from raw defs when signed.
     *
     * @param snapshot cached snapshot
     * @return true if applied
     */
    public boolean applyCachedSnapshot(FeatureSnapshot snapshot) {
        if (snapshot == null || snapshot.isEmpty()) {
            return false;
        }
        try {
            if (config.isUseSignedDefinitions()) {
                if (!snapshot.hasSignatureMetadata()) {
                    reportError(
                            "Snapshot is missing SignedDefsJson; loaded without cryptographic re-verification. Clear and refresh to upgrade the snapshot.",
                            null);
                } else {
                    JsonWebKeySet keySet = loadOrFetchJwks();
                    Es256Verifier.verify(
                            snapshot.getSignedDefsJson(),
                            snapshot.getSignedTimestamp(),
                            snapshot.getSignature(),
                            snapshot.getKeyId(),
                            keySet,
                            config.getAllowedKeyIds());
                }
            }
            applySnapshot(snapshot);
            return true;
        } catch (Exception e) {
            reportError("Failed to apply cached snapshot", e);
            return false;
        }
    }

    private void applySnapshot(FeatureSnapshot snapshot) {
        currentSnapshot.set(snapshot);
        if (snapshot.getEtag() != null) {
            lastEtag.set(snapshot.getEtag());
        }
        if (snapshot.getSignedTimestamp() != null) {
            lastSignedTimestamp.set(snapshot.getSignedTimestamp());
        }
    }

    @Override
    public void clear() {
        currentSnapshot.set(FeatureSnapshot.empty());
        lastEtag.set(null);
        lastSignedTimestamp.set(0);
        clearJwks();
    }

    @Override
    public void clearJwks() {
        jwks.set(null);
        jwksExpiry.set(Instant.EPOCH);
    }

    @Override
    public JsonWebKeySet loadJwks() {
        Instant expiry = jwksExpiry.get();
        JsonWebKeySet cached = jwks.get();
        if (cached != null && Instant.now().isBefore(expiry)) {
            return cached;
        }
        return null;
    }

    @Override
    public void saveJwks(JsonWebKeySet keySet, Instant expiry) {
        if (keySet != null) {
            jwks.set(keySet);
            jwksExpiry.set(expiry != null ? expiry : Instant.now().plusSeconds(JWKS_TTL_DAYS * 24 * 3600));
        }
    }

    private void refreshSilently() {
        try {
            if (wsConnected) {
                long elapsed = System.currentTimeMillis() - lastFallbackRefresh;
                if (elapsed < FALLBACK_REFRESH_INTERVAL) {
                    LOGGER.log(Level.FINE, "Skipping scheduled refresh — WebSocket is connected");
                    return;
                }
                LOGGER.log(Level.FINE, "Fallback refresh interval elapsed, refreshing via HTTP");
                lastFallbackRefresh = System.currentTimeMillis();
            }
            refresh();
        } catch (Exception e) {
            LOGGER.log(Level.FINE, "Background refresh failed", e);
        }
    }

    private FeatureSnapshot fetchDefinitions() {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(definitionsUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", SdkIdentity.userAgent());

            String etag = lastEtag.get();
            if (etag != null) {
                connection.setRequestProperty("If-None-Match", etag);
            }

            int responseCode = connection.getResponseCode();

            if (responseCode == HttpURLConnection.HTTP_NOT_MODIFIED) {
                return currentSnapshot.get();
            }

            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new TogglyNetworkException(
                        "Failed to fetch definitions: HTTP " + responseCode,
                        responseCode);
            }

            String newEtag = connection.getHeaderField("ETag");
            if (newEtag != null) {
                lastEtag.set(newEtag);
            }

            String responseBody = readResponse(connection.getInputStream());
            return parseDefinitions(responseBody, newEtag);

        } catch (TogglyNetworkException | TogglySignatureException e) {
            throw e;
        } catch (IOException e) {
            throw new TogglyNetworkException("Network error fetching definitions", e);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String readResponse(InputStream inputStream) throws IOException {
        StringBuilder response = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                response.append(line);
            }
        }
        return response.toString();
    }

    private FeatureSnapshot parseDefinitions(String json, String etag) {
        Map<String, FeatureDefinition> features = new HashMap<>();
        Map<String, MetricDefinition> metrics = new HashMap<>();

        String signedDefsJson = null;
        String signature = null;
        String kid = null;
        Long signedTs = null;

        if (config.isUseSignedDefinitions()) {
            signedDefsJson = extractRawJsonValue(json, "defs");
            signature = extractStringValue(json, "signature");
            kid = extractStringValue(json, "kid");
            signedTs = extractLongValue(json, "timestamp");

            if (signedDefsJson == null) {
                throw new TogglySignatureException("Signed response missing defs");
            }
            if (signature == null || signature.isEmpty()) {
                throw new TogglySignatureException("Signed response missing signature");
            }
            if (kid == null || kid.isEmpty()) {
                throw new TogglySignatureException("Signed response missing kid");
            }
            if (signedTs == null) {
                throw new TogglySignatureException("Signed response missing timestamp");
            }
            if (signedTs < lastSignedTimestamp.get() && lastSignedTimestamp.get() > 0) {
                LOGGER.log(Level.FINE, "Ignoring older signed definitions timestamp");
                return currentSnapshot.get();
            }

            JsonWebKeySet keySet = loadOrFetchJwks();
            Es256Verifier.verify(
                    signedDefsJson,
                    signedTs,
                    signature,
                    kid,
                    keySet,
                    config.getAllowedKeyIds());

            String arrayContent = signedDefsJson.trim();
            if (arrayContent.startsWith("[") && arrayContent.endsWith("]")) {
                arrayContent = arrayContent.substring(1, arrayContent.length() - 1);
            }
            parseFeatures(arrayContent, features);
        } else {
            String featuresJson = null;
            for (String key : new String[]{"defs", "feature_flags"}) {
                featuresJson = extractArrayByKey(json, key);
                if (featuresJson != null) break;
            }
            if (featuresJson == null && json.trim().startsWith("[")) {
                featuresJson = json.trim().substring(1, json.trim().length() - 1);
            }
            if (featuresJson != null) {
                parseFeatures(featuresJson, features);
            }
        }

        Pattern metricsPattern = Pattern.compile(
                "\"metrics\"\\s*:\\s*\\[([^\\]]*)]",
                Pattern.DOTALL);
        Matcher metricsMatcher = metricsPattern.matcher(json);
        if (metricsMatcher.find()) {
            parseMetrics(metricsMatcher.group(1), metrics);
        }

        return new FeatureSnapshot(
                features, metrics, Instant.now(), etag,
                signature, kid, signedTs, signedDefsJson);
    }

    private JsonWebKeySet loadOrFetchJwks() {
        JsonWebKeySet cached = loadJwks();
        if (cached != null) {
            return cached;
        }

        String baseUrl = config.getBaseUrl();
        if (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }
        String jwksUrl = baseUrl + "/.well-known/jwks";

        HttpURLConnection connection = null;
        try {
            URL url = new URL(jwksUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", SdkIdentity.userAgent());

            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new TogglyNetworkException(
                        "Failed to fetch JWKS: HTTP " + responseCode, responseCode);
            }

            String body = readResponse(connection.getInputStream());
            JsonWebKeySet keySet = parseJwks(body);
            Instant expiry = Instant.now().plusSeconds(JWKS_TTL_DAYS * 24 * 3600);
            for (JsonWebKey key : keySet.getKeys()) {
                if (key.getExp() != null) {
                    Instant keyExp = Instant.ofEpochSecond(key.getExp());
                    if (keyExp.isBefore(expiry)) {
                        expiry = keyExp;
                    }
                }
            }
            saveJwks(keySet, expiry);
            return keySet;
        } catch (TogglyNetworkException e) {
            throw e;
        } catch (IOException e) {
            throw new TogglyNetworkException("Network error fetching JWKS", e);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private JsonWebKeySet parseJwks(String json) {
        List<JsonWebKey> keys = new ArrayList<>();
        Pattern keysPattern = Pattern.compile("\"keys\"\\s*:\\s*\\[", Pattern.DOTALL);
        Matcher keysMatcher = keysPattern.matcher(json);
        if (!keysMatcher.find()) {
            return JsonWebKeySet.empty();
        }
        int start = json.indexOf('[', keysMatcher.start());
        String arrayContent = extractBalancedArray(json, start);
        if (arrayContent == null) {
            return JsonWebKeySet.empty();
        }

        int braceCount = 0;
        int objStart = -1;
        for (int i = 0; i < arrayContent.length(); i++) {
            char c = arrayContent.charAt(i);
            if (c == '{') {
                if (braceCount == 0) objStart = i;
                braceCount++;
            } else if (c == '}') {
                braceCount--;
                if (braceCount == 0 && objStart >= 0) {
                    String keyJson = arrayContent.substring(objStart, i + 1);
                    String kty = extractStringValue(keyJson, "kty");
                    String kid = extractStringValue(keyJson, "kid");
                    String crv = extractStringValue(keyJson, "crv");
                    String x = extractStringValue(keyJson, "x");
                    String y = extractStringValue(keyJson, "y");
                    String alg = extractStringValue(keyJson, "alg");
                    String use = extractStringValue(keyJson, "use");
                    Long exp = extractLongValue(keyJson, "exp");
                    if (kid != null && x != null && y != null) {
                        keys.add(new JsonWebKey(
                                kty != null ? kty : "EC",
                                kid,
                                crv != null ? crv : "P-256",
                                x,
                                y,
                                alg != null ? alg : "ES256",
                                use != null ? use : "sig",
                                exp));
                    }
                    objStart = -1;
                }
            }
        }
        return new JsonWebKeySet(keys);
    }

    /**
     * Extracts the exact JSON value for a key (array or object), preserving raw bytes.
     */
    private String extractRawJsonValue(String json, String key) {
        String search = "\"" + key + "\"";
        int idx = json.indexOf(search);
        if (idx < 0) return null;

        idx = idx + search.length();
        while (idx < json.length() && Character.isWhitespace(json.charAt(idx))) idx++;
        if (idx >= json.length() || json.charAt(idx) != ':') return null;
        idx++;
        while (idx < json.length() && Character.isWhitespace(json.charAt(idx))) idx++;
        if (idx >= json.length()) return null;

        char start = json.charAt(idx);
        if (start == '[') {
            String content = extractBalancedArray(json, idx);
            return content != null ? "[" + content + "]" : null;
        }
        if (start == '{') {
            int end = findMatchingBrace(json, idx);
            return end > idx ? json.substring(idx, end + 1) : null;
        }
        return null;
    }

    private int findMatchingBrace(String json, int start) {
        int count = 0;
        boolean inString = false;
        for (int i = start; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '"' && (i == 0 || json.charAt(i - 1) != '\\')) {
                inString = !inString;
            } else if (!inString) {
                if (c == '{') count++;
                else if (c == '}') {
                    count--;
                    if (count == 0) return i;
                }
            }
        }
        return -1;
    }

    private String extractArrayByKey(String json, String key) {
        String search = "\"" + key + "\"";
        int idx = json.indexOf(search);
        if (idx < 0) return null;

        idx = json.indexOf('[', idx + search.length());
        if (idx < 0) return null;

        return extractBalancedArray(json, idx);
    }

    private String extractBalancedArray(String json, int openIdx) {
        int depth = 0;
        boolean inString = false;
        for (int i = openIdx; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '"' && (i == 0 || json.charAt(i - 1) != '\\')) {
                inString = !inString;
            } else if (!inString) {
                if (c == '[') {
                    depth++;
                } else if (c == ']' && --depth == 0) {
                    return json.substring(openIdx + 1, i);
                }
            }
        }
        return null;
    }

    private void parseFeatures(String json, Map<String, FeatureDefinition> features) {
        int braceCount = 0;
        int start = -1;
        for (int i = 0; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '{') {
                if (braceCount == 0) start = i;
                braceCount++;
            } else if (c == '}') {
                braceCount--;
                if (braceCount == 0 && start >= 0) {
                    String featureJson = json.substring(start, i + 1);
                    FeatureDefinition def = parseFeatureDefinition(featureJson);
                    if (def != null && def.getFeatureKey() != null) {
                        features.put(def.getFeatureKey(), def);
                    }
                    start = -1;
                }
            }
        }
    }

    private FeatureDefinition parseFeatureDefinition(String json) {
        String featureKey = extractStringValue(json, "feature_key");
        if (featureKey == null) {
            featureKey = extractStringValue(json, "featureKey");
        }
        if (featureKey == null) return null;

        String requirementStr = extractStringValue(json, "requirement_type");
        if (requirementStr == null) {
            requirementStr = extractStringValue(json, "requirementType");
        }
        FeatureRequirement requirement = "All".equalsIgnoreCase(requirementStr)
                ? FeatureRequirement.ALL
                : FeatureRequirement.ANY;

        List<FeatureFilter> filters = parseFilters(json);

        return FeatureDefinition.builder()
                .featureKey(featureKey)
                .requirementType(requirement)
                .filters(filters)
                .build();
    }

    private List<FeatureFilter> parseFilters(String json) {
        List<FeatureFilter> filters = new ArrayList<>();

        Pattern filtersPattern = Pattern.compile(
                "\"filters\"\\s*:\\s*\\[([^\\]]*(?:\\{[^}]*}[^\\]]*)*)]",
                Pattern.DOTALL);
        Matcher matcher = filtersPattern.matcher(json);
        if (!matcher.find()) return filters;

        String filtersJson = matcher.group(1);
        int braceCount = 0;
        int start = -1;
        for (int i = 0; i < filtersJson.length(); i++) {
            char c = filtersJson.charAt(i);
            if (c == '{') {
                if (braceCount == 0) start = i;
                braceCount++;
            } else if (c == '}') {
                braceCount--;
                if (braceCount == 0 && start >= 0) {
                    String filterJson = filtersJson.substring(start, i + 1);
                    FeatureFilter filter = parseFilter(filterJson);
                    if (filter != null) {
                        filters.add(filter);
                    }
                    start = -1;
                }
            }
        }

        return filters;
    }

    private FeatureFilter parseFilter(String json) {
        String name = extractStringValue(json, "name");
        if (name == null) return null;

        Map<String, Object> parameters = new HashMap<>();

        Pattern paramsPattern = Pattern.compile(
                "\"parameters\"\\s*:\\s*\\{([^}]*)}",
                Pattern.DOTALL);
        Matcher paramsMatcher = paramsPattern.matcher(json);
        if (paramsMatcher.find()) {
            parseParameters(paramsMatcher.group(1), parameters);
        }

        return FeatureFilter.of(name, parameters);
    }

    private void parseParameters(String json, Map<String, Object> parameters) {
        Pattern keyValuePattern = Pattern.compile(
                "\"([^\"]+)\"\\s*:\\s*(\"[^\"]*\"|[\\d.]+|true|false|null)",
                Pattern.DOTALL);
        Matcher matcher = keyValuePattern.matcher(json);
        while (matcher.find()) {
            String key = matcher.group(1);
            String value = matcher.group(2);

            if (value.startsWith("\"") && value.endsWith("\"")) {
                parameters.put(key, value.substring(1, value.length() - 1));
            } else if ("true".equals(value)) {
                parameters.put(key, Boolean.TRUE);
            } else if ("false".equals(value)) {
                parameters.put(key, Boolean.FALSE);
            } else if ("null".equals(value)) {
                parameters.put(key, null);
            } else {
                try {
                    if (value.contains(".")) {
                        parameters.put(key, Double.parseDouble(value));
                    } else {
                        parameters.put(key, Long.parseLong(value));
                    }
                } catch (NumberFormatException e) {
                    parameters.put(key, value);
                }
            }
        }
    }

    private void parseMetrics(String json, Map<String, MetricDefinition> metrics) {
        int braceCount = 0;
        int start = -1;
        for (int i = 0; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '{') {
                if (braceCount == 0) start = i;
                braceCount++;
            } else if (c == '}') {
                braceCount--;
                if (braceCount == 0 && start >= 0) {
                    String metricJson = json.substring(start, i + 1);
                    String key = extractStringValue(metricJson, "metric_key");
                    if (key == null) key = extractStringValue(metricJson, "metricKey");
                    String name = extractStringValue(metricJson, "name");
                    String unit = extractStringValue(metricJson, "unit");

                    if (key != null) {
                        metrics.put(key, MetricDefinition.of(name != null ? name : key, "counter", unit));
                    }
                    start = -1;
                }
            }
        }
    }

    private String extractStringValue(String json, String key) {
        Pattern pattern = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }

    private Long extractLongValue(String json, String key) {
        Pattern pattern = Pattern.compile("\"" + key + "\"\\s*:\\s*(-?\\d+)");
        Matcher matcher = pattern.matcher(json);
        if (matcher.find()) {
            try {
                return Long.parseLong(matcher.group(1));
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private void reportError(String message, Throwable error) {
        BiConsumer<String, Throwable> callback = config.getOnError();
        if (callback != null) {
            try {
                callback.accept(message, error);
            } catch (Exception callbackEx) {
                LOGGER.log(Level.WARNING, "OnError callback threw", callbackEx);
            }
        }
    }

    // ========== WebSocket Live Updates ==========

    private void startWebSocket() {
        String baseUrl = config.getBaseUrl();
        if (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }
        String wsUrl = SdkIdentity.appendSdkQueryParams(
                baseUrl
                        .replace("https://", "wss://")
                        .replace("http://", "ws://")
                        + "/" + config.getAppKey() + "/ws",
                lastEtag.get());

        LOGGER.log(Level.INFO, "Connecting WebSocket to {0}", wsUrl);

        HttpClient client = HttpClient.newHttpClient();
        client.newWebSocketBuilder()
                .buildAsync(URI.create(wsUrl), new WebSocket.Listener() {

                    private final StringBuilder messageBuffer = new StringBuilder();

                    @Override
                    public void onOpen(WebSocket ws) {
                        LOGGER.log(Level.INFO, "WebSocket connected");
                        webSocket = ws;
                        wsConnected = true;
                        lastFallbackRefresh = System.currentTimeMillis();
                        ws.request(1);
                    }

                    @Override
                    public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
                        messageBuffer.append(data);
                        if (last) {
                            String message = messageBuffer.toString();
                            messageBuffer.setLength(0);
                            handleWebSocketMessage(message);
                        }
                        ws.request(1);
                        return null;
                    }

                    @Override
                    public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
                        LOGGER.log(Level.INFO, "WebSocket closed: {0} {1}",
                                new Object[]{statusCode, reason});
                        wsConnected = false;
                        webSocket = null;
                        scheduleReconnect();
                        return null;
                    }

                    @Override
                    public void onError(WebSocket ws, Throwable error) {
                        LOGGER.log(Level.WARNING, "WebSocket error", error);
                        wsConnected = false;
                        webSocket = null;
                        scheduleReconnect();
                    }
                })
                .exceptionally(ex -> {
                    LOGGER.log(Level.WARNING, "WebSocket connection failed", ex);
                    wsConnected = false;
                    webSocket = null;
                    scheduleReconnect();
                    return null;
                });
    }

    private void handleWebSocketMessage(String message) {
        try {
            String type = extractStringValue(message, "type");
            if (type == null) {
                type = extractStringValue(message, "event");
            }

            if ("ping".equalsIgnoreCase(type)) {
                LOGGER.log(Level.FINE, "WebSocket ping received");
                return;
            }

            if ("signing-key-updated".equalsIgnoreCase(type)) {
                LOGGER.log(Level.INFO, "WebSocket signing-key-updated, clearing JWKS and refreshing");
                clearJwks();
                lastEtag.set(null);
                refreshSilently();
                return;
            }

            if ("flags-updated".equalsIgnoreCase(type) || "update".equalsIgnoreCase(type)) {
                LOGGER.log(Level.INFO, "WebSocket received update notification, refreshing definitions");
                refreshSilently();
            }
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error handling WebSocket message", e);
        }
    }

    private void scheduleReconnect() {
        if (scheduler != null && !scheduler.isShutdown() && config.isEnableLiveUpdates()) {
            LOGGER.log(Level.INFO, "Scheduling WebSocket reconnect in {0}ms", WS_RECONNECT_DELAY);
            scheduler.schedule(this::startWebSocket, WS_RECONNECT_DELAY, TimeUnit.MILLISECONDS);
        }
    }

    private void stopWebSocket() {
        if (webSocket != null) {
            try {
                webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "");
            } catch (Exception e) {
                LOGGER.log(Level.FINE, "Error closing WebSocket", e);
            }
            webSocket = null;
            wsConnected = false;
        }
    }

    @Override
    public void close() {
        stopWebSocket();
        if (scheduler != null && !scheduler.isShutdown()) {
            scheduler.shutdown();
            try {
                if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                    scheduler.shutdownNow();
                }
            } catch (InterruptedException e) {
                scheduler.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
    }
}
