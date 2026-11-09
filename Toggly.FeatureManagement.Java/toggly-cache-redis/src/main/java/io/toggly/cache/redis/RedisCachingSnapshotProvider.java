package io.toggly.cache.redis;

import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureRequirement;
import io.toggly.core.model.MetricDefinition;
import io.toggly.core.model.VariantAllocation;
import io.toggly.core.model.VariantDefinition;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.HttpSnapshotProvider;
import io.toggly.core.snapshot.RefreshListenerSupport;
import io.toggly.core.snapshot.SnapshotProvider;
import io.toggly.core.telemetry.DefinitionCacheRecorder;
import io.toggly.core.util.SimpleJson;
import io.toggly.core.util.VariantJson;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Redis-based caching snapshot provider for distributed environments.
 *
 * <p>Stores feature definitions in Redis for sharing across multiple instances.</p>
 *
 * <p>Usage:</p>
 * <pre>{@code
 * SnapshotProvider httpProvider = new HttpSnapshotProvider(config);
 * SnapshotProvider redisProvider = new RedisCachingSnapshotProvider(
 *     httpProvider,
 *     RedisCacheConfig.builder()
 *         .host("redis.example.com")
 *         .port(6379)
 *         .ttl(Duration.ofMinutes(5))
 *         .keyPrefix("myapp:toggly:")
 *         .build()
 * );
 *
 * TogglyClient client = new TogglyClient(config, redisProvider);
 * }</pre>
 */
public class RedisCachingSnapshotProvider implements SnapshotProvider {

    private static final Logger LOGGER = Logger.getLogger(RedisCachingSnapshotProvider.class.getName());
    private static final String SNAPSHOT_KEY = "snapshot";

    private final SnapshotProvider delegate;
    private final RedisCacheConfig config;
    private final JedisPool pool;
    private final String cacheKey;
    private final AtomicReference<DefinitionCacheRecorder> definitionCacheRecorder = new AtomicReference<>();
    private final AtomicBoolean durableStartupCounted = new AtomicBoolean(false);
    private final RefreshListenerSupport refreshListeners =
            new RefreshListenerSupport(RedisCachingSnapshotProvider.class);
    /**
     * Receives underlying apply-on-change notifications, persists to Redis first, then
     * notifies wrapper listeners so onRefresh callbacks observe the updated cache.
     */
    private final Consumer<FeatureSnapshot> delegateRefreshBridge = this::onDelegateSnapshotApplied;

    /**
     * Creates a Redis caching provider with default configuration.
     *
     * @param delegate the underlying provider
     */
    public RedisCachingSnapshotProvider(SnapshotProvider delegate) {
        this(delegate, RedisCacheConfig.defaults());
    }

    /**
     * Creates a Redis caching provider with custom configuration.
     *
     * @param delegate the underlying provider
     * @param config the cache configuration
     */
    public RedisCachingSnapshotProvider(SnapshotProvider delegate, RedisCacheConfig config) {
        this.delegate = delegate;
        this.config = config;
        this.cacheKey = config.getKeyPrefix() + SNAPSHOT_KEY;
        this.pool = createPool(config);
        this.delegate.addRefreshListener(delegateRefreshBridge);
    }

    /**
     * Creates a Redis caching provider with an existing JedisPool.
     *
     * @param delegate the underlying provider
     * @param pool the Jedis pool
     * @param keyPrefix the key prefix
     * @param ttl the TTL for cached entries
     */
    public RedisCachingSnapshotProvider(SnapshotProvider delegate, JedisPool pool,
                                        String keyPrefix, Duration ttl) {
        this.delegate = delegate;
        this.config = RedisCacheConfig.builder()
                .keyPrefix(keyPrefix)
                .ttl(ttl)
                .build();
        this.cacheKey = keyPrefix + SNAPSHOT_KEY;
        this.pool = pool;
        this.delegate.addRefreshListener(delegateRefreshBridge);
    }

    private JedisPool createPool(RedisCacheConfig config) {
        JedisPoolConfig poolConfig = new JedisPoolConfig();
        poolConfig.setMaxTotal(10);
        poolConfig.setMaxIdle(5);
        poolConfig.setMinIdle(1);
        poolConfig.setTestOnBorrow(true);

        if (config.isSsl()) {
            return new JedisPool(poolConfig, config.getHost(), config.getPort(),
                    config.getTimeout(), config.getPassword(), config.getDatabase(), true);
        }

        if (config.getPassword() != null && !config.getPassword().isEmpty()) {
            return new JedisPool(poolConfig, config.getHost(), config.getPort(),
                    config.getTimeout(), config.getPassword(), config.getDatabase());
        }

        return new JedisPool(poolConfig, config.getHost(), config.getPort(),
                config.getTimeout());
    }

    @Override
    public FeatureSnapshot getSnapshot() {
        // Release the connection before deserialize. Adopting a peer revision
        // notifies listeners, and the Redis bridge checks out another connection.
        String cached = readCache();
        if (cached != null && !cached.isEmpty()) {
            FeatureSnapshot snapshot = deserialize(cached);
            if (snapshot != null) {
                return snapshot;
            }
        }
        return refresh();
    }

    private String readCache() {
        try (Jedis jedis = pool.getResource()) {
            return jedis.get(cacheKey);
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error reading from Redis cache", e);
            return null;
        }
    }

    @Override
    public CompletableFuture<FeatureSnapshot> getSnapshotAsync() {
        return CompletableFuture.supplyAsync(this::getSnapshot);
    }

    @Override
    public FeatureSnapshot refresh() {
        FeatureSnapshot snapshot = delegate.refresh();
        // Persist even on unchanged/304 refreshes (bridge only runs when the delegate applies).
        persistSnapshot(snapshot);
        return snapshot;
    }

    private void onDelegateSnapshotApplied(FeatureSnapshot snapshot) {
        persistSnapshot(snapshot);
        refreshListeners.notifyListeners(snapshot);
    }

    private void persistSnapshot(FeatureSnapshot snapshot) {
        if (snapshot == null) {
            return;
        }
        try (Jedis jedis = pool.getResource()) {
            String serialized = serialize(snapshot);
            long ttlSeconds = config.getTtl().toSeconds();
            if (ttlSeconds > 0) {
                jedis.setex(cacheKey, ttlSeconds, serialized);
            } else {
                jedis.set(cacheKey, serialized);
            }
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error writing to Redis cache", e);
        }
    }

    @Override
    public CompletableFuture<FeatureSnapshot> refreshAsync() {
        return CompletableFuture.supplyAsync(this::refresh);
    }

    /**
     * Invalidates the cached snapshot.
     */
    public void invalidate() {
        try (Jedis jedis = pool.getResource()) {
            jedis.del(cacheKey);
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error invalidating Redis cache", e);
        }
        delegate.clear();
    }

    @Override
    public void clear() {
        invalidate();
        durableStartupCounted.set(false);
    }

    @Override
    public void clearJwks() {
        delegate.clearJwks();
    }

    @Override
    public void setDefinitionCacheRecorder(DefinitionCacheRecorder recorder) {
        this.definitionCacheRecorder.set(recorder);
        delegate.setDefinitionCacheRecorder(recorder);
    }

    @Override
    public void addRefreshListener(Consumer<FeatureSnapshot> listener) {
        refreshListeners.add(listener);
    }

    @Override
    public void removeRefreshListener(Consumer<FeatureSnapshot> listener) {
        refreshListeners.remove(listener);
    }

    @Override
    public void close() {
        delegate.removeRefreshListener(delegateRefreshBridge);
        if (pool != null && !pool.isClosed()) {
            pool.close();
        }
        delegate.close();
    }

    // Simple JSON serialization/deserialization (no external deps)

    private String serialize(FeatureSnapshot snapshot) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"features\":{");

        boolean first = true;
        for (Map.Entry<String, FeatureDefinition> entry : snapshot.getFeatures().entrySet()) {
            if (!first) sb.append(",");
            sb.append("\"").append(escapeJson(entry.getKey())).append("\":");
            sb.append(serializeFeature(entry.getValue()));
            first = false;
        }

        sb.append("},\"metrics\":{");

        first = true;
        for (Map.Entry<String, MetricDefinition> entry : snapshot.getMetrics().entrySet()) {
            if (!first) sb.append(",");
            sb.append("\"").append(escapeJson(entry.getKey())).append("\":");
            sb.append(serializeMetric(entry.getValue()));
            first = false;
        }

        sb.append("},\"timestamp\":\"").append(snapshot.getTimestamp()).append("\"");
        if (snapshot.getEtag() != null) {
            sb.append(",\"etag\":\"").append(escapeJson(snapshot.getEtag())).append("\"");
        }
        if (snapshot.getSignature() != null) {
            sb.append(",\"signature\":\"").append(escapeJson(snapshot.getSignature())).append("\"");
        }
        if (snapshot.getKeyId() != null) {
            sb.append(",\"keyId\":\"").append(escapeJson(snapshot.getKeyId())).append("\"");
        }
        if (snapshot.getSignedTimestamp() != null) {
            sb.append(",\"signedTimestamp\":").append(snapshot.getSignedTimestamp());
        }
        if (snapshot.getSignedDefsJson() != null) {
            sb.append(",\"signedDefsJson\":").append(jsonStringLiteral(snapshot.getSignedDefsJson()));
        }
        sb.append("}");

        return sb.toString();
    }

    private String jsonStringLiteral(String value) {
        return "\"" + escapeJson(value) + "\"";
    }

    private String serializeFeature(FeatureDefinition feature) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"featureKey\":\"").append(escapeJson(feature.getFeatureKey())).append("\"");
        sb.append(",\"requirementType\":\"").append(feature.getRequirementType()).append("\"");
        if (feature.getContextKind() != null) {
            sb.append(",\"contextKind\":\"").append(escapeJson(feature.getContextKind())).append("\"");
        }
        if (feature.getContextRequirementType() != null) {
            sb.append(",\"contextRequirementType\":\"").append(feature.getContextRequirementType()).append("\"");
        }

        if (feature.getFilters() != null && !feature.getFilters().isEmpty()) {
            sb.append(",\"filters\":[");
            boolean first = true;
            for (FeatureFilter filter : feature.getFilters()) {
                if (!first) sb.append(",");
                sb.append(serializeFilter(filter));
                first = false;
            }
            sb.append("]");
        }

        if (feature.getVariants() != null && !feature.getVariants().isEmpty()) {
            sb.append(",\"variants\":")
                    .append(SimpleJson.serialize(VariantJson.serializeVariants(feature.getVariants())));
        }

        if (feature.getAllocation() != null) {
            sb.append(",\"allocation\":")
                    .append(SimpleJson.serialize(VariantJson.serializeAllocation(feature.getAllocation())));
        }

        sb.append("}");
        return sb.toString();
    }

    private String serializeFilter(FeatureFilter filter) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"name\":\"").append(escapeJson(filter.getName())).append("\"");

        if (filter.getParameters() != null && !filter.getParameters().isEmpty()) {
            sb.append(",\"parameters\":{");
            boolean first = true;
            for (Map.Entry<String, Object> param : filter.getParameters().entrySet()) {
                if (!first) sb.append(",");
                sb.append("\"").append(escapeJson(param.getKey())).append("\":");
                sb.append(serializeValue(param.getValue()));
                first = false;
            }
            sb.append("}");
        }

        sb.append("}");
        return sb.toString();
    }

    private String serializeValue(Object value) {
        if (value == null) return "null";
        if (value instanceof Boolean) return value.toString();
        if (value instanceof Number) return value.toString();
        return "\"" + escapeJson(value.toString()) + "\"";
    }

    private String serializeMetric(MetricDefinition metric) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"metricKey\":\"").append(escapeJson(metric.getMetricKey())).append("\"");
        if (metric.getName() != null) {
            sb.append(",\"name\":\"").append(escapeJson(metric.getName())).append("\"");
        }
        if (metric.getType() != null) {
            sb.append(",\"type\":\"").append(escapeJson(metric.getType())).append("\"");
        }
        if (metric.getUnit() != null) {
            sb.append(",\"unit\":\"").append(escapeJson(metric.getUnit())).append("\"");
        }
        sb.append("}");
        return sb.toString();
    }

    private String escapeJson(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    private FeatureSnapshot deserialize(String json) {
        try {
            if (!isCompleteJsonObject(json)) {
                return null;
            }
            Map<String, FeatureDefinition> features = new HashMap<>();
            Map<String, MetricDefinition> metrics = new HashMap<>();

            String featuresJson = extractObjectByKey(json, "features");
            if (featuresJson == null) {
                return null;
            }
            parseFeatures(featuresJson, features);

            String metricsJson = extractObjectByKey(json, "metrics");
            if (metricsJson != null && !metricsJson.isBlank()) {
                parseMetrics(metricsJson, metrics);
            }

            // Parse timestamp
            String timestampStr = extractStringValue(json, "timestamp");
            Instant timestamp = timestampStr != null ? Instant.parse(timestampStr) : Instant.now();

            String etag = extractStringValue(json, "etag");
            String signature = extractStringValue(json, "signature");
            String keyId = extractStringValue(json, "keyId");
            Long signedTimestamp = extractLongValue(json, "signedTimestamp");
            String signedDefsJson = extractRawStringValue(json, "signedDefsJson");

            FeatureSnapshot snapshot = new FeatureSnapshot(
                    features, metrics, timestamp, etag,
                    signature, keyId, signedTimestamp, signedDefsJson);

            // Route durable Redis loads (signed and unsigned) through Http apply so
            // startup-from-cache records exactly one definition-cache hit.
            if (delegate instanceof HttpSnapshotProvider http) {
                if (!http.applyCachedSnapshot(snapshot)) {
                    return null;
                }
                return http.getSnapshot();
            } else if (durableStartupCounted.compareAndSet(false, true)) {
                DefinitionCacheRecorder recorder = definitionCacheRecorder.get();
                if (recorder != null) {
                    recorder.recordDefinitionCacheHit();
                }
            }

            return snapshot;
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error deserializing snapshot from Redis", e);
            return null;
        }
    }

    /**
     * Rejects truncated cache values before their nested feature object can be
     * mistaken for a complete root object.
     */
    private boolean isCompleteJsonObject(String json) {
        if (json == null) {
            return false;
        }
        int start = 0;
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) {
            start++;
        }
        if (start >= json.length() || json.charAt(start) != '{') {
            return false;
        }
        int end = findMatchingBrace(json, start);
        if (end < 0) {
            return false;
        }
        for (int index = end + 1; index < json.length(); index++) {
            if (!Character.isWhitespace(json.charAt(index))) {
                return false;
            }
        }
        return true;
    }

    /**
     * Extracts the raw object body (without surrounding braces) for a root JSON key.
     * A feature key or string value with the same name is not a match.
     */
    private String extractObjectByKey(String json, String key) {
        int index = skipFeatureWhitespace(json, 0);
        if (index >= json.length() || json.charAt(index) != '{') {
            return null;
        }
        return objectBodyAtRoot(json, key, index + 1);
    }

    private String objectBodyAtRoot(String json, String key, int index) {
        int[] cursor = {index};
        while (cursor[0] >= 0 && cursor[0] < json.length()) {
            cursor[0] = skipFeatureSeparators(json, cursor[0]);
            if (cursor[0] >= json.length() || json.charAt(cursor[0]) == '}') {
                return null;
            }
            String name = readRootName(json, cursor);
            if (name == null || !moveToRootValue(json, cursor)) {
                return null;
            }
            if (key.equals(name)) {
                return objectInterior(json, cursor[0]);
            }
            cursor[0] = skipJsonValue(json, cursor[0]);
        }
        return null;
    }

    private String readRootName(String json, int[] cursor) {
        if (json.charAt(cursor[0]) != '"') {
            return null;
        }
        Object parsedKey = SimpleJson.parseValue(json, cursor);
        if (parsedKey instanceof String name) {
            return name;
        }
        return null;
    }

    private boolean moveToRootValue(String json, int[] cursor) {
        int index = skipFeatureWhitespace(json, cursor[0]);
        if (index >= json.length() || json.charAt(index) != ':') {
            return false;
        }
        index = skipFeatureWhitespace(json, index + 1);
        if (index >= json.length()) {
            return false;
        }
        cursor[0] = index;
        return true;
    }

    private String objectInterior(String json, int index) {
        if (index >= json.length() || json.charAt(index) != '{') {
            return null;
        }
        int end = findMatchingBrace(json, index);
        if (end <= index) {
            return null;
        }
        return json.substring(index + 1, end);
    }

    private int skipJsonValue(String json, int index) {
        char current = json.charAt(index);
        if (current == '{') {
            int end = findMatchingBrace(json, index);
            return end < 0 ? -1 : end + 1;
        }
        if (current == '[') {
            int end = SimpleJson.findMatchingBracket(json, index);
            return end < 0 ? -1 : end + 1;
        }
        if (current == '"') {
            int[] position = {index};
            SimpleJson.parseValue(json, position);
            return position[0];
        }
        while (index < json.length()) {
            char currentChar = json.charAt(index);
            if (currentChar == ',' || currentChar == '}' || Character.isWhitespace(currentChar)) {
                break;
            }
            index++;
        }
        return index;
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

    private String extractRawStringValue(String json, String key) {
        Pattern pattern = Pattern.compile("\"" + key + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
        Matcher matcher = pattern.matcher(json);
        if (!matcher.find()) {
            return null;
        }
        return unescapeJson(matcher.group(1));
    }

    private String unescapeJson(String value) {
        StringBuilder decoded = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (current != '\\' || index + 1 >= value.length()) {
                decoded.append(current);
                continue;
            }
            index++;
            decoded.append(unescaped(value.charAt(index)));
        }
        return decoded.toString();
    }

    private static char unescaped(char escaped) {
        if (escaped == '"') {
            return '"';
        }
        if (escaped == '\\') {
            return '\\';
        }
        if (escaped == 'n') {
            return '\n';
        }
        if (escaped == 'r') {
            return '\r';
        }
        if (escaped == 't') {
            return '\t';
        }
        return escaped;
    }

    private void parseMetrics(String json, Map<String, MetricDefinition> metrics) {
        parseKeyedObjects(json, (key, body) -> {
            String name = extractStringValue(body, "name");
            if (name == null) {
                name = extractStringValue(body, "metricKey");
            }
            if (name == null) {
                name = key;
            }
            metrics.put(key, MetricDefinition.of(
                    name,
                    extractStringValue(body, "type"),
                    extractStringValue(body, "unit")));
        });
    }

    private void parseFeatures(String json, Map<String, FeatureDefinition> features) {
        // Only top-level "key":{...} entries. Nested filter objects must not become features.
        parseKeyedObjects(json, (key, body) -> features.put(key, parseFeatureDefinition(body, key)));
    }

    private void parseKeyedObjects(String json, BiConsumer<String, String> consumer) {
        int cursor = skipFeatureSeparators(json, 0);
        while (cursor < json.length()) {
            if (json.charAt(cursor) != '"') {
                throw new IllegalArgumentException("Invalid cached object entry");
            }
            int[] position = {cursor};
            String key = (String) SimpleJson.parseValue(json, position);
            int colon = skipFeatureWhitespace(json, position[0]);
            if (colon >= json.length() || json.charAt(colon) != ':') {
                throw new IllegalArgumentException("Invalid cached object entry");
            }
            int valueStart = skipFeatureWhitespace(json, colon + 1);
            if (valueStart >= json.length() || json.charAt(valueStart) != '{') {
                throw new IllegalArgumentException("Invalid cached object entry");
            }
            int end = findMatchingBrace(json, valueStart);
            if (end <= valueStart) {
                throw new IllegalArgumentException("Invalid cached object entry");
            }
            consumer.accept(key, json.substring(valueStart, end + 1));
            cursor = skipFeatureSeparators(json, end + 1);
        }
    }

    private int skipFeatureSeparators(String json, int cursor) {
        while (cursor < json.length()
                && (Character.isWhitespace(json.charAt(cursor)) || json.charAt(cursor) == ',')) {
            cursor++;
        }
        return cursor;
    }

    private int skipFeatureWhitespace(String json, int cursor) {
        while (cursor < json.length() && Character.isWhitespace(json.charAt(cursor))) {
            cursor++;
        }
        return cursor;
    }

    private int findMatchingBrace(String json, int start) {
        return SimpleJson.findMatchingBrace(json, start);
    }

    private FeatureDefinition parseFeatureDefinition(String json, String key) {
        String featureKey = extractStringValue(json, "featureKey");
        if (featureKey == null) featureKey = key;

        String requirementStr = extractStringValue(json, "requirementType");
        FeatureRequirement requirement = "ALL".equalsIgnoreCase(requirementStr)
                ? FeatureRequirement.ALL
                : FeatureRequirement.ANY;

        List<FeatureFilter> filters = parseFilters(json);

        String contextKind = extractStringValue(json, "contextKind");
        String contextReqStr = extractStringValue(json, "contextRequirementType");
        FeatureRequirement contextRequirement = contextReqStr == null || contextReqStr.isBlank()
                ? null
                : FeatureRequirement.fromString(contextReqStr);

        List<VariantDefinition> variants = VariantJson.parseVariants(json);
        VariantAllocation allocation = VariantJson.parseAllocation(json);

        return FeatureDefinition.builder()
                .featureKey(featureKey)
                .requirementType(requirement)
                .contextKind(contextKind)
                .contextRequirementType(contextRequirement)
                .filters(filters)
                .variants(variants)
                .allocation(allocation)
                .build();
    }

    private List<FeatureFilter> parseFilters(String json) {
        List<FeatureFilter> filters = new ArrayList<>();

        String search = "\"filters\"";
        int idx = json.indexOf(search);
        if (idx < 0) {
            return filters;
        }
        int arrayStart = json.indexOf('[', idx + search.length());
        if (arrayStart < 0) {
            return filters;
        }
        int arrayEnd = SimpleJson.findMatchingBracket(json, arrayStart);
        if (arrayEnd <= arrayStart) {
            return filters;
        }
        String filtersJson = json.substring(arrayStart + 1, arrayEnd);
        for (String filterJson : SimpleJson.splitTopLevelObjects(filtersJson)) {
            FeatureFilter filter = parseFilter(filterJson);
            if (filter != null) {
                filters.add(filter);
            }
        }

        return filters;
    }

    private FeatureFilter parseFilter(String json) {
        String name = extractStringValue(json, "name");
        if (name == null) return null;

        Map<String, Object> parameters = new HashMap<>();
        String search = "\"parameters\"";
        int idx = json.indexOf(search);
        if (idx >= 0) {
            int braceStart = json.indexOf('{', idx + search.length());
            if (braceStart >= 0) {
                int braceEnd = findMatchingBrace(json, braceStart);
                if (braceEnd > braceStart) {
                    parseParameters(json.substring(braceStart + 1, braceEnd), parameters);
                }
            }
        }

        return FeatureFilter.of(name, parameters);
    }

    private void parseParameters(String json, Map<String, Object> parameters) {
        Pattern kvPattern = Pattern.compile("\"([^\"]+)\"\\s*:\\s*(\"[^\"]*\"|[\\d.]+|true|false|null)");
        Matcher matcher = kvPattern.matcher(json);
        while (matcher.find()) {
            String key = matcher.group(1);
            String value = matcher.group(2);

            if (value.startsWith("\"") && value.endsWith("\"")) {
                parameters.put(key, unescapeJson(value.substring(1, value.length() - 1)));
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

    private String extractStringValue(String json, String key) {
        return extractRawStringValue(json, key);
    }
}
