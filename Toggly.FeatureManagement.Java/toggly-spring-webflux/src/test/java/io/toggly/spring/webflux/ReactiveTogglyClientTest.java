package io.toggly.spring.webflux;

import io.toggly.core.TogglyClient;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureRequirement;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertSame;

class ReactiveTogglyClientTest {

    @Test
    void evaluatesFeaturesAndGatesWithReactorOrExplicitContext() {
        TogglyClient client = TestTogglyClients.clientWith("feature", "other");
        ReactiveTogglyClient reactive = new ReactiveTogglyClient(client);
        EvaluationContext context = TestTogglyClients.context();

        StepVerifier.create(reactive.isEnabled("feature")
                        .contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .expectNext(true)
                .verifyComplete();
        StepVerifier.create(reactive.isEnabled("feature", context)).expectNext(true).verifyComplete();
        StepVerifier.create(reactive.allEnabled(List.of("feature"))
                        .contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .expectNext(true)
                .verifyComplete();
        StepVerifier.create(reactive.anyEnabled(List.of("feature"))
                        .contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .expectNext(true)
                .verifyComplete();
        StepVerifier.create(reactive.noneEnabled(List.of("feature"))
                        .contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .expectNext(false)
                .verifyComplete();
        StepVerifier.create(reactive.gate(List.of("feature"), FeatureRequirement.ALL, false, context))
                .expectNext(true)
                .verifyComplete();
    }

    @Test
    void selectsConditionalPublishersForEnabledAndDisabledFeatures() {
        TogglyClient client = TestTogglyClients.clientWith("enabled");
        ReactiveTogglyClient reactive = new ReactiveTogglyClient(client);
        EvaluationContext context = TestTogglyClients.context();

        StepVerifier.create(reactive.ifEnabled("enabled", reactor.core.publisher.Mono.just("yes"))
                        .contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .expectNext("yes")
                .verifyComplete();
        StepVerifier.create(reactive.ifEnabled("disabled", reactor.core.publisher.Mono.just("no"))
                        .contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .verifyComplete();
        StepVerifier.create(reactive.switchOn("enabled", reactor.core.publisher.Mono.just("yes"),
                        reactor.core.publisher.Mono.just("no"))
                        .contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .expectNext("yes")
                .verifyComplete();
        StepVerifier.create(reactive.switchOn("disabled", reactor.core.publisher.Mono.just("yes"),
                        reactor.core.publisher.Mono.just("no"))
                        .contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .expectNext("no")
                .verifyComplete();
    }

    @Test
    void exposesDefinitionsEvaluationsAndEnabledFeatures() {
        TogglyClient client = TestTogglyClients.clientWith("one");
        ReactiveTogglyClient reactive = new ReactiveTogglyClient(client);
        EvaluationContext context = TestTogglyClients.context();

        StepVerifier.create(reactive.getFeatureKeys()).expectNext(Set.of("one")).verifyComplete();
        StepVerifier.create(reactive.getFeatureDefinition("one"))
                .expectNext(TestTogglyClients.enabledFeature("one"))
                .verifyComplete();
        StepVerifier.create(reactive.getAllFeatures()).expectNext(client.getAllFeatures()).verifyComplete();
        StepVerifier.create(reactive.evaluateAll().contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .expectNext(client.evaluateAll(context))
                .verifyComplete();
        StepVerifier.create(reactive.evaluateAll(context)).expectNext(client.evaluateAll(context)).verifyComplete();
        StepVerifier.create(reactive.enabledFeatures().contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY, context)))
                .expectNext("one")
                .verifyComplete();
    }

    @Test
    void delegatesLifecycleOperationsAndExposesWrappedClient() {
        TogglyClient client = TestTogglyClients.clientWith();
        ReactiveTogglyClient reactive = new ReactiveTogglyClient(client);

        assertSame(client, reactive.getClient());
        StepVerifier.create(reactive.refresh()).verifyComplete();
        reactive.close();

    }
}
