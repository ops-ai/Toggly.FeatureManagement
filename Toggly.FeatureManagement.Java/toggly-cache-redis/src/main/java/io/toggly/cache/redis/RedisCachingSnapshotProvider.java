package io.toggly.cache.redis;

import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureRequirement;
import io.toggly.core.model.MetricDefinition;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.SnapshotProvider;
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
        // Try to get from cache first
        try (Jedis jedis = pool.getResource()) {
            String cached = jedis.get(cacheKey);
            if (cached != null && !cached.isEmpty()) {
                FeatureSnapshot snapshot = deserialize(cached);
                if (snapshot != null) {
                    return snapshot;
                }
            }
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error reading from Redis cache", e);
        }

        // Cache miss - fetch from delegate and cache
        return refresh();
    }

    @Override
    public CompletableFuture<FeatureSnapshot> getSnapshotAsync() {
        return CompletableFuture.supplyAsync(this::getSnapshot);
    }

    @Override
    public FeatureSnapshot refresh() {
        FeatureSnapshot snapshot = delegate.refresh();

        // Store in Redis
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

        return snapshot;
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
    }

    @Override
    public void clearJwks() {
        delegate.clearJwks();
    }

    @Override
    public void close() {
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
            Map<String, FeatureDefinition> features = new HashMap<>();
            Map<String, MetricDefinition> metrics = new HashMap<>();

            // Parse features
            Pattern featuresPattern = Pattern.compile(
                    "\"features\"\\s*:\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}",
                    Pattern.DOTALL);
            Matcher featuresMatcher = featuresPattern.matcher(json);
            if (featuresMatcher.find()) {
                parseFeatures(featuresMatcher.group(1), features);
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

            if (snapshot.hasSignatureMetadata()
                    && delegate instanceof io.toggly.core.snapshot.HttpSnapshotProvider) {
                io.toggly.core.snapshot.HttpSnapshotProvider http =
                        (io.toggly.core.snapshot.HttpSnapshotProvider) delegate;
                if (!http.applyCachedSnapshot(snapshot)) {
                    return null;
                }
            }

            return snapshot;
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error deserializing snapshot from Redis", e);
            return null;
        }
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
        return value.replace("\\\"", "\"")
                .replace("\\\\", "\\")
                .replace("\\n", "\n")
                .replace("\\r", "\r")
                .replace("\\t", "\t");
    }

    private void parseFeatures(String json, Map<String, FeatureDefinition> features) {
        // Simple parsing - match feature objects
        Pattern keyPattern = Pattern.compile("\"([^\"]+)\"\\s*:\\s*\\{");
        Matcher keyMatcher = keyPattern.matcher(json);

        while (keyMatcher.find()) {
            String key = keyMatcher.group(1);
            int start = keyMatcher.end() - 1;
            int end = findMatchingBrace(json, start);
            if (end > start) {
                String featureJson = json.substring(start, end + 1);
                FeatureDefinition def = parseFeatureDefinition(featureJson, key);
                if (def != null) {
                    features.put(key, def);
                }
            }
        }
    }

    private int findMatchingBrace(String json, int start) {
        int count = 0;
        for (int i = start; i < json.length(); i++) {
            if (json.charAt(i) == '{') count++;
            else if (json.charAt(i) == '}') {
                count--;
                if (count == 0) return i;
            }
        }
        return -1;
    }

    private FeatureDefinition parseFeatureDefinition(String json, String key) {
        String featureKey = extractStringValue(json, "featureKey");
        if (featureKey == null) featureKey = key;

        String requirementStr = extractStringValue(json, "requirementType");
        FeatureRequirement requirement = "ALL".equalsIgnoreCase(requirementStr)
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

        Pattern filtersPattern = Pattern.compile("\"filters\"\\s*:\\s*\\[([^\\]]*)\\]");
        Matcher matcher = filtersPattern.matcher(json);
        if (!matcher.find()) return filters;

        String filtersJson = matcher.group(1);
        // Parse individual filter objects
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
                    if (filter != null) filters.add(filter);
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
        Pattern paramsPattern = Pattern.compile("\"parameters\"\\s*:\\s*\\{([^}]*)\\}");
        Matcher paramsMatcher = paramsPattern.matcher(json);
        if (paramsMatcher.find()) {
            parseParameters(paramsMatcher.group(1), parameters);
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
                parameters.put(key, value.substring(1, value.length() - 1));
            } else if ("true".equals(value)) {
                parameters.put(key, Boolean.TRUE);
            } else if ("false".equals(value)) {
                parameters.put(key, Boolean.FALSE);
            } else if (!"null".equals(value)) {
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
        Pattern pattern = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? matcher.group(1) : null;
    }
}
