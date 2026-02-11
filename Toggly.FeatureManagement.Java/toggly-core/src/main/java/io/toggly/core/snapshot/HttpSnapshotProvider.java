package io.toggly.core.snapshot;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.exception.TogglyNetworkException;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureRequirement;
import io.toggly.core.model.MetricDefinition;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HTTP-based snapshot provider that fetches definitions from Toggly API.
 *
 * <p>Uses only JDK classes for zero external dependencies.</p>
 */
public final class HttpSnapshotProvider implements SnapshotProvider {

    private static final Logger LOGGER = Logger.getLogger(HttpSnapshotProvider.class.getName());
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private final TogglyConfig config;
    private final String definitionsUrl;
    private final AtomicReference<FeatureSnapshot> currentSnapshot;
    private final AtomicReference<String> lastEtag;
    private final ScheduledExecutorService scheduler;

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

        // Start background refresh if interval is configured
        long intervalSeconds = config.getRefreshIntervalSeconds();
        if (intervalSeconds > 0) {
            this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "toggly-refresh");
                t.setDaemon(true);
                return t;
            });
            scheduler.scheduleWithFixedDelay(
                    this::refreshSilently,
                    intervalSeconds,
                    intervalSeconds,
                    TimeUnit.SECONDS);
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
        return baseUrl + "/definitions/" + config.getAppKey() + "/" + env;
    }

    @Override
    public FeatureSnapshot getSnapshot() {
        FeatureSnapshot snapshot = currentSnapshot.get();
        if (snapshot.isEmpty()) {
            // First access - try to fetch
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
                currentSnapshot.set(newSnapshot);
                return newSnapshot;
            }
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Failed to refresh definitions", e);
        }
        return currentSnapshot.get();
    }

    @Override
    public CompletableFuture<FeatureSnapshot> refreshAsync() {
        return CompletableFuture.supplyAsync(this::refresh);
    }

    private void refreshSilently() {
        try {
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
            connection.setRequestProperty("User-Agent", "Toggly-Java-SDK/1.0");

            // Send ETag for conditional request
            String etag = lastEtag.get();
            if (etag != null) {
                connection.setRequestProperty("If-None-Match", etag);
            }

            int responseCode = connection.getResponseCode();

            if (responseCode == HttpURLConnection.HTTP_NOT_MODIFIED) {
                // No changes
                return currentSnapshot.get();
            }

            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new TogglyNetworkException(
                        "Failed to fetch definitions: HTTP " + responseCode,
                        responseCode);
            }

            // Store new ETag
            String newEtag = connection.getHeaderField("ETag");
            if (newEtag != null) {
                lastEtag.set(newEtag);
            }

            // Read response
            String responseBody = readResponse(connection.getInputStream());

            // Parse JSON (simple parser for zero dependencies)
            return parseDefinitions(responseBody, newEtag);

        } catch (TogglyNetworkException e) {
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

    /**
     * Simple JSON parser for feature definitions.
     * Avoids external dependencies like Jackson/Gson.
     */
    private FeatureSnapshot parseDefinitions(String json, String etag) {
        Map<String, FeatureDefinition> features = new HashMap<>();
        Map<String, MetricDefinition> metrics = new HashMap<>();

        // Parse feature_flags array
        Pattern featurePattern = Pattern.compile(
                "\"feature_flags\"\\s*:\\s*\\[([^\\]]*(?:\\[[^\\]]*\\][^\\]]*)*)]",
                Pattern.DOTALL);
        Matcher featureMatcher = featurePattern.matcher(json);
        if (featureMatcher.find()) {
            String featuresJson = featureMatcher.group(1);
            parseFeatures(featuresJson, features);
        }

        // Parse metrics array if present
        Pattern metricsPattern = Pattern.compile(
                "\"metrics\"\\s*:\\s*\\[([^\\]]*)]",
                Pattern.DOTALL);
        Matcher metricsMatcher = metricsPattern.matcher(json);
        if (metricsMatcher.find()) {
            String metricsJson = metricsMatcher.group(1);
            parseMetrics(metricsJson, metrics);
        }

        return new FeatureSnapshot(features, metrics, Instant.now(), etag);
    }

    private void parseFeatures(String json, Map<String, FeatureDefinition> features) {
        // Split by objects (simplified parsing)
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

        // Extract parameters object
        Pattern paramsPattern = Pattern.compile(
                "\"parameters\"\\s*:\\s*\\{([^}]*)}",
                Pattern.DOTALL);
        Matcher paramsMatcher = paramsPattern.matcher(json);
        if (paramsMatcher.find()) {
            String paramsJson = paramsMatcher.group(1);
            parseParameters(paramsJson, parameters);
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
        // Simple metric parsing
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
                    String description = extractStringValue(metricJson, "description");
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

    @Override
    public void close() {
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
