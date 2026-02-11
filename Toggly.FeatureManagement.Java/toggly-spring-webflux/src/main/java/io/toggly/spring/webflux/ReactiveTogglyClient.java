package io.toggly.spring.webflux;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureRequirement;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Reactive wrapper around {@link TogglyClient}.
 *
 * <p>Provides reactive APIs that integrate with Reactor context
 * for evaluation context propagation.</p>
 *
 * <p>Usage:</p>
 * <pre>{@code
 * @RestController
 * public class MyController {
 *     private final ReactiveTogglyClient toggly;
 *
 *     @GetMapping("/api/data")
 *     public Mono<ResponseEntity<Data>> getData() {
 *         return toggly.isEnabled("new-data-api")
 *             .flatMap(enabled -> {
 *                 if (enabled) {
 *                     return newDataService.getData();
 *                 }
 *                 return oldDataService.getData();
 *             })
 *             .map(ResponseEntity::ok);
 *     }
 * }
 * }</pre>
 */
public class ReactiveTogglyClient {

    private final TogglyClient client;

    /**
     * Creates a reactive client wrapping the standard client.
     *
     * @param client the TogglyClient
     */
    public ReactiveTogglyClient(TogglyClient client) {
        this.client = client;
    }

    /**
     * Creates a reactive client from configuration.
     *
     * @param config the Toggly configuration
     */
    public ReactiveTogglyClient(TogglyConfig config) {
        this(new TogglyClient(config));
    }

    /**
     * Gets the underlying synchronous client.
     *
     * @return the TogglyClient
     */
    public TogglyClient getClient() {
        return client;
    }

    // ========== Feature Evaluation ==========

    /**
     * Checks if a feature is enabled using context from Reactor context.
     *
     * @param featureKey the feature key
     * @return Mono emitting true if enabled
     */
    public Mono<Boolean> isEnabled(String featureKey) {
        return TogglyContextFilter.getContext()
                .map(ctx -> client.isEnabled(featureKey, ctx));
    }

    /**
     * Checks if a feature is enabled with explicit context.
     *
     * @param featureKey the feature key
     * @param context the evaluation context
     * @return Mono emitting true if enabled
     */
    public Mono<Boolean> isEnabled(String featureKey, EvaluationContext context) {
        return Mono.fromSupplier(() -> client.isEnabled(featureKey, context));
    }

    // ========== Feature Gate ==========

    /**
     * Evaluates a gate that requires ALL features to be enabled.
     *
     * @param featureKeys the feature keys
     * @return Mono emitting true if all enabled
     */
    public Mono<Boolean> allEnabled(List<String> featureKeys) {
        return TogglyContextFilter.getContext()
                .map(ctx -> client.gate(featureKeys, FeatureRequirement.ALL, false, ctx));
    }

    /**
     * Evaluates a gate that requires ANY feature to be enabled.
     *
     * @param featureKeys the feature keys
     * @return Mono emitting true if any enabled
     */
    public Mono<Boolean> anyEnabled(List<String> featureKeys) {
        return TogglyContextFilter.getContext()
                .map(ctx -> client.gate(featureKeys, FeatureRequirement.ANY, false, ctx));
    }

    /**
     * Evaluates a gate that requires NONE of the features to be enabled.
     *
     * @param featureKeys the feature keys
     * @return Mono emitting true if none enabled
     */
    public Mono<Boolean> noneEnabled(List<String> featureKeys) {
        return TogglyContextFilter.getContext()
                .map(ctx -> client.gate(featureKeys, FeatureRequirement.ANY, true, ctx));
    }

    /**
     * Evaluates a feature gate.
     *
     * @param featureKeys the feature keys
     * @param requirement ALL or ANY
     * @param negate whether to negate
     * @param context the evaluation context
     * @return Mono emitting the result
     */
    public Mono<Boolean> gate(List<String> featureKeys, FeatureRequirement requirement,
                              boolean negate, EvaluationContext context) {
        return Mono.fromSupplier(() -> client.gate(featureKeys, requirement, negate, context));
    }

    // ========== Conditional Execution ==========

    /**
     * Executes an action if the feature is enabled.
     *
     * @param featureKey the feature key
     * @param action the action to execute
     * @param <T> the result type
     * @return Mono with the result or empty if disabled
     */
    public <T> Mono<T> ifEnabled(String featureKey, Mono<T> action) {
        return isEnabled(featureKey)
                .flatMap(enabled -> enabled ? action : Mono.empty());
    }

    /**
     * Returns one of two values based on feature state.
     *
     * @param featureKey the feature key
     * @param enabledMono value when enabled
     * @param disabledMono value when disabled
     * @param <T> the value type
     * @return Mono with the appropriate value
     */
    public <T> Mono<T> switchOn(String featureKey, Mono<T> enabledMono, Mono<T> disabledMono) {
        return isEnabled(featureKey)
                .flatMap(enabled -> enabled ? enabledMono : disabledMono);
    }

    // ========== Feature Definitions ==========

    /**
     * Gets all feature keys.
     *
     * @return Mono emitting set of feature keys
     */
    public Mono<Set<String>> getFeatureKeys() {
        return Mono.fromSupplier(client::getFeatureKeys);
    }

    /**
     * Gets a feature definition.
     *
     * @param featureKey the feature key
     * @return Mono emitting the definition or empty
     */
    public Mono<FeatureDefinition> getFeatureDefinition(String featureKey) {
        return Mono.fromSupplier(() -> client.getFeatureDefinition(featureKey));
    }

    /**
     * Gets all feature definitions.
     *
     * @return Mono emitting map of definitions
     */
    public Mono<Map<String, FeatureDefinition>> getAllFeatures() {
        return Mono.fromSupplier(client::getAllFeatures);
    }

    /**
     * Evaluates all features and returns their states.
     *
     * @return Mono emitting map of feature states
     */
    public Mono<Map<String, Boolean>> evaluateAll() {
        return TogglyContextFilter.getContext()
                .map(client::evaluateAll);
    }

    /**
     * Evaluates all features with explicit context.
     *
     * @param context the evaluation context
     * @return Mono emitting map of feature states
     */
    public Mono<Map<String, Boolean>> evaluateAll(EvaluationContext context) {
        return Mono.fromSupplier(() -> client.evaluateAll(context));
    }

    /**
     * Gets all enabled features as a Flux.
     *
     * @return Flux of enabled feature keys
     */
    public Flux<String> enabledFeatures() {
        return TogglyContextFilter.getContext()
                .flatMapMany(ctx -> Flux.fromIterable(client.getFeatureKeys())
                        .filter(key -> client.isEnabled(key, ctx)));
    }

    // ========== Refresh ==========

    /**
     * Refreshes feature definitions.
     *
     * @return Mono completing when refresh is done
     */
    public Mono<Void> refresh() {
        return Mono.fromRunnable(client::refresh)
                .subscribeOn(Schedulers.boundedElastic())
                .then();
    }

    // ========== Lifecycle ==========

    /**
     * Closes the underlying client.
     */
    public void close() {
        client.close();
    }
}
