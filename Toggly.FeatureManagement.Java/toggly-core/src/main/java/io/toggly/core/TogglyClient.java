package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.ContextHolder;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.eval.EvaluationEngine;
import io.toggly.core.eval.EvaluatorRegistry;
import io.toggly.core.exception.TogglyConfigException;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureRequirement;
import io.toggly.core.model.MetricDefinition;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.HttpSnapshotProvider;
import io.toggly.core.snapshot.SnapshotProvider;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.stream.Collectors;

/**
 * Main client for Toggly feature flag management.
 *
 * <p>This is the primary entry point for evaluating feature flags.</p>
 *
 * <h2>Basic Usage:</h2>
 * <pre>{@code
 * TogglyConfig config = TogglyConfig.builder()
 *     .appKey("your-app-key")
 *     .environment("Production")
 *     .build();
 *
 * TogglyClient client = new TogglyClient(config);
 *
 * if (client.isEnabled("my-feature")) {
 *     // Feature is enabled
 * }
 * }</pre>
 *
 * <h2>With Context:</h2>
 * <pre>{@code
 * EvaluationContext context = EvaluationContext.builder()
 *     .identity("user-123")
 *     .group("beta-testers")
 *     .build();
 *
 * if (client.isEnabled("my-feature", context)) {
 *     // Feature is enabled for this user
 * }
 * }</pre>
 */
public final class TogglyClient implements AutoCloseable {

    private static final Logger LOGGER = Logger.getLogger(TogglyClient.class.getName());

    private final TogglyConfig config;
    private final SnapshotProvider snapshotProvider;
    private final EvaluationEngine evaluationEngine;
    private final boolean ownsProvider;

    /**
     * Creates a client with the specified configuration.
     *
     * @param config the Toggly configuration
     */
    public TogglyClient(TogglyConfig config) {
        this(config, null, null);
    }

    /**
     * Creates a client with custom snapshot provider.
     *
     * @param config the Toggly configuration
     * @param snapshotProvider custom snapshot provider (null for default HTTP provider)
     */
    public TogglyClient(TogglyConfig config, SnapshotProvider snapshotProvider) {
        this(config, snapshotProvider, null);
    }

    /**
     * Creates a client with custom components.
     *
     * @param config the Toggly configuration
     * @param snapshotProvider custom snapshot provider (null for default HTTP provider)
     * @param registry custom evaluator registry (null for default)
     */
    public TogglyClient(TogglyConfig config, SnapshotProvider snapshotProvider, EvaluatorRegistry registry) {
        if (config == null) {
            throw new TogglyConfigException("Configuration must not be null");
        }
        if (config.getAppKey() == null || config.getAppKey().isEmpty()) {
            throw new TogglyConfigException("App key must be configured");
        }

        this.config = config;

        if (snapshotProvider != null) {
            this.snapshotProvider = snapshotProvider;
            this.ownsProvider = false;
        } else {
            this.snapshotProvider = new HttpSnapshotProvider(config);
            this.ownsProvider = true;
        }

        this.evaluationEngine = new EvaluationEngine(registry);
    }

    /**
     * Gets the configuration.
     *
     * @return the configuration
     */
    public TogglyConfig getConfig() {
        return config;
    }

    /**
     * Gets the evaluator registry for registering custom evaluators.
     *
     * @return the evaluator registry
     */
    public EvaluatorRegistry getRegistry() {
        return evaluationEngine.getRegistry();
    }

    // ========== Feature Evaluation ==========

    /**
     * Checks if a feature is enabled using the current thread context.
     *
     * @param featureKey the feature key
     * @return true if the feature is enabled
     */
    public boolean isEnabled(String featureKey) {
        return isEnabled(featureKey, ContextHolder.getContext());
    }

    /**
     * Checks if a feature is enabled for the given context.
     *
     * @param featureKey the feature key
     * @param context the evaluation context
     * @return true if the feature is enabled
     */
    public boolean isEnabled(String featureKey, EvaluationContext context) {
        if (featureKey == null || featureKey.isEmpty()) {
            return false;
        }

        try {
            FeatureSnapshot snapshot = snapshotProvider.getSnapshot();
            FeatureDefinition definition = snapshot.getFeature(featureKey);

            EvaluationContext effectiveContext = resolveContext(context);

            return evaluationEngine.evaluateWithDefaults(
                    definition,
                    effectiveContext,
                    featureKey,
                    config.getFeatureDefaults(),
                    config.getDefaultFeatureState());
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error evaluating feature: " + featureKey, e);
            return config.getDefaultFeatureState();
        }
    }

    /**
     * Checks if a feature is enabled asynchronously.
     *
     * @param featureKey the feature key
     * @return a future that completes with the evaluation result
     */
    public CompletableFuture<Boolean> isEnabledAsync(String featureKey) {
        return isEnabledAsync(featureKey, ContextHolder.getContext());
    }

    /**
     * Checks if a feature is enabled asynchronously with context.
     *
     * @param featureKey the feature key
     * @param context the evaluation context
     * @return a future that completes with the evaluation result
     */
    public CompletableFuture<Boolean> isEnabledAsync(String featureKey, EvaluationContext context) {
        return snapshotProvider.getSnapshotAsync()
                .thenApply(snapshot -> {
                    if (featureKey == null || featureKey.isEmpty()) {
                        return false;
                    }
                    FeatureDefinition definition = snapshot.getFeature(featureKey);
                    EvaluationContext effectiveContext = resolveContext(context);
                    return evaluationEngine.evaluateWithDefaults(
                            definition,
                            effectiveContext,
                            featureKey,
                            config.getFeatureDefaults(),
                            config.getDefaultFeatureState());
                })
                .exceptionally(e -> {
                    LOGGER.log(Level.WARNING, "Async error evaluating feature: " + featureKey, e);
                    return config.getDefaultFeatureState();
                });
    }

    // ========== Feature Gate ==========

    /**
     * Evaluates a gate that requires ALL features to be enabled.
     *
     * @param featureKeys the feature keys to check
     * @return true if all features are enabled
     */
    public boolean allEnabled(List<String> featureKeys) {
        return gate(featureKeys, FeatureRequirement.ALL, false, ContextHolder.getContext());
    }

    /**
     * Evaluates a gate that requires ANY feature to be enabled.
     *
     * @param featureKeys the feature keys to check
     * @return true if any feature is enabled
     */
    public boolean anyEnabled(List<String> featureKeys) {
        return gate(featureKeys, FeatureRequirement.ANY, false, ContextHolder.getContext());
    }

    /**
     * Evaluates a gate that requires NONE of the features to be enabled.
     *
     * @param featureKeys the feature keys to check
     * @return true if none of the features are enabled
     */
    public boolean noneEnabled(List<String> featureKeys) {
        return gate(featureKeys, FeatureRequirement.ANY, true, ContextHolder.getContext());
    }

    /**
     * Evaluates a feature gate.
     *
     * @param featureKeys the feature keys
     * @param requirement ALL or ANY
     * @param negate whether to negate the result
     * @param context the evaluation context
     * @return true if the gate passes
     */
    public boolean gate(List<String> featureKeys, FeatureRequirement requirement,
                        boolean negate, EvaluationContext context) {
        try {
            FeatureSnapshot snapshot = snapshotProvider.getSnapshot();
            EvaluationContext effectiveContext = resolveContext(context);

            return evaluationEngine.evaluateGate(
                    snapshot.getFeatures(),
                    featureKeys,
                    effectiveContext,
                    requirement,
                    negate);
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error evaluating gate", e);
            return !negate && config.getDefaultFeatureState();
        }
    }

    // ========== Conditional Execution ==========

    /**
     * Executes an action if the feature is enabled.
     *
     * @param featureKey the feature key
     * @param action the action to execute
     * @return true if the action was executed
     */
    public boolean ifEnabled(String featureKey, Runnable action) {
        if (isEnabled(featureKey)) {
            action.run();
            return true;
        }
        return false;
    }

    /**
     * Executes one of two actions based on feature state.
     *
     * @param featureKey the feature key
     * @param enabledAction action when enabled
     * @param disabledAction action when disabled
     */
    public void ifEnabledElse(String featureKey, Runnable enabledAction, Runnable disabledAction) {
        if (isEnabled(featureKey)) {
            enabledAction.run();
        } else {
            disabledAction.run();
        }
    }

    /**
     * Gets a value based on feature state.
     *
     * @param featureKey the feature key
     * @param enabledValue value when enabled
     * @param disabledValue value when disabled
     * @param <T> the value type
     * @return the appropriate value
     */
    public <T> T getValue(String featureKey, T enabledValue, T disabledValue) {
        return isEnabled(featureKey) ? enabledValue : disabledValue;
    }

    /**
     * Gets a value from a supplier based on feature state.
     *
     * @param featureKey the feature key
     * @param enabledSupplier supplier when enabled
     * @param disabledSupplier supplier when disabled
     * @param <T> the value type
     * @return the appropriate value
     */
    public <T> T getValue(String featureKey, Supplier<T> enabledSupplier, Supplier<T> disabledSupplier) {
        return isEnabled(featureKey) ? enabledSupplier.get() : disabledSupplier.get();
    }

    // ========== Feature Definitions ==========

    /**
     * Gets all feature keys.
     *
     * @return set of feature keys
     */
    public Set<String> getFeatureKeys() {
        return snapshotProvider.getSnapshot().getFeatures().keySet();
    }

    /**
     * Gets a feature definition.
     *
     * @param featureKey the feature key
     * @return the definition or null
     */
    public FeatureDefinition getFeatureDefinition(String featureKey) {
        return snapshotProvider.getSnapshot().getFeature(featureKey);
    }

    /**
     * Gets all feature definitions.
     *
     * @return map of feature key to definition
     */
    public Map<String, FeatureDefinition> getAllFeatures() {
        return snapshotProvider.getSnapshot().getFeatures();
    }

    /**
     * Evaluates all features and returns their states.
     *
     * @return map of feature key to enabled state
     */
    public Map<String, Boolean> evaluateAll() {
        return evaluateAll(ContextHolder.getContext());
    }

    /**
     * Evaluates all features with context and returns their states.
     *
     * @param context the evaluation context
     * @return map of feature key to enabled state
     */
    public Map<String, Boolean> evaluateAll(EvaluationContext context) {
        return snapshotProvider.getSnapshot().getFeatures().keySet().stream()
                .collect(Collectors.toMap(
                        key -> key,
                        key -> isEnabled(key, context)));
    }

    // ========== Metrics ==========

    /**
     * Gets a metric definition.
     *
     * @param metricKey the metric key
     * @return the metric definition or null
     */
    public MetricDefinition getMetricDefinition(String metricKey) {
        return snapshotProvider.getSnapshot().getMetrics().get(metricKey);
    }

    /**
     * Gets all metric definitions.
     *
     * @return map of metric key to definition
     */
    public Map<String, MetricDefinition> getAllMetrics() {
        return snapshotProvider.getSnapshot().getMetrics();
    }

    // ========== Refresh ==========

    /**
     * Manually refreshes the feature definitions.
     */
    public void refresh() {
        snapshotProvider.refresh();
    }

    /**
     * Manually refreshes the feature definitions asynchronously.
     *
     * @return a future that completes when refresh is done
     */
    public CompletableFuture<Void> refreshAsync() {
        return snapshotProvider.refreshAsync().thenApply(s -> null);
    }

    /**
     * Clears cached feature definitions and JWKS.
     */
    public void clearCache() {
        snapshotProvider.clear();
    }

    /**
     * Registers a listener for snapshot changes.
     *
     * @param listener the listener to register
     */
    public void onRefresh(Consumer<FeatureSnapshot> listener) {
        // Would require observer pattern implementation in snapshot provider
        // Left as extension point
    }

    // ========== Lifecycle ==========

    @Override
    public void close() {
        if (ownsProvider) {
            snapshotProvider.close();
        }
    }

    // ========== Private Helpers ==========

    private EvaluationContext resolveContext(EvaluationContext context) {
        if (context != null) {
            // Merge with configured identity if not set
            if (context.getIdentity() == null && config.getDefaultIdentity() != null) {
                return EvaluationContext.builder()
                        .identity(config.getDefaultIdentity())
                        .groups(context.getGroups())
                        .traits(context.getTraits())
                        .build();
            }
            return context;
        }

        // Use configured identity
        if (config.getDefaultIdentity() != null) {
            return EvaluationContext.builder()
                    .identity(config.getDefaultIdentity())
                    .build();
        }

        return EvaluationContext.empty();
    }
}
