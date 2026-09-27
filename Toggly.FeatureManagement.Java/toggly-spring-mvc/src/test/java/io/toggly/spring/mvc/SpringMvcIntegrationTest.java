package io.toggly.spring.mvc;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.ContextHolder;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.method.HandlerMethod;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SpringMvcIntegrationTest {

    private final InMemorySnapshotProvider snapshots = new InMemorySnapshotProvider();
    private TogglyClient client;

    @BeforeEach
    void setUp() {
        TogglyConfig config = TogglyConfig.builder().appKey("test")
                .enableUsageTracking(false).enableMetrics(false).build();
        client = new TogglyClient(config, snapshots);
    }

    @AfterEach
    void tearDown() {
        ContextHolder.clear();
        client.close();
    }

    @Test
    void gateIgnoresNonHandlerAndUnannotatedMethod() throws Exception {
        assertTrue(gate(new Object()).allowed());
        assertTrue(gate(handler(PlainController.class, "plain")).allowed());
    }

    @Test
    void negatedAnyMethodGateBlocksWithCustomStatusWhenOneFeatureIsOn() throws Exception {
        snapshots.setFeatures(Map.of("beta", enabled("beta")));
        GateResult result = gate(handler(MethodController.class, "preview"));
        assertFalse(result.allowed());
        assertEquals(403, result.status());
    }

    @Test
    void negatedAnyMethodGateAllowsWhenBothFeaturesAreOff() throws Exception {
        assertTrue(gate(handler(MethodController.class, "preview")).allowed());
    }

    @Test
    void classGateBlocksWithDefaultStatusWhenFeatureIsOff() throws Exception {
        GateResult result = gate(handler(ClassController.class, "plain"));
        assertFalse(result.allowed());
        assertEquals(404, result.status());
    }

    @Test
    void classGateAllowsWhenFeatureIsOn() throws Exception {
        snapshots.setFeatures(Map.of("general", enabled("general")));
        assertTrue(gate(handler(ClassController.class, "plain")).allowed());
    }

    @Test
    void classGateStillBlocksAfterMethodGateAllows() throws Exception {
        GateResult result = gate(handler(ClassController.class, "preview"));
        assertFalse(result.allowed());
        assertEquals(404, result.status());
    }

    @Test
    void argumentResolverSupportsOnlyAnnotatedParameters() throws Exception {
        FeatureArgumentResolver resolver = new FeatureArgumentResolver(client);
        assertTrue(resolver.supportsParameter(parameter("enabled")));
        assertFalse(resolver.supportsParameter(parameter("plain")));
    }

    @Test
    void argumentResolverUsesRequestIdentityForFeatureTargeting() throws Exception {
        snapshots.setFeatures(Map.of("preview", FeatureDefinition.builder()
                .featureKey("preview")
                .filters(List.of(FeatureFilter.of("Targeting", Map.of("users", "alice"))))
                .build()));
        FeatureArgumentResolver resolver = new FeatureArgumentResolver(client);
        ContextHolder.setContext(EvaluationContext.forIdentity("alice"));
        assertEquals(true, resolver.resolveArgument(parameter("enabled"), null, null, null));
        ContextHolder.setContext(EvaluationContext.forIdentity("bob"));
        assertEquals(false, resolver.resolveArgument(parameter("enabled"), null, null, null));
    }

    @Test
    void argumentResolverHandlesBoxedUnannotatedAndInvalidParameters() throws Exception {
        FeatureArgumentResolver resolver = new FeatureArgumentResolver(client);
        assertEquals(false, resolver.resolveArgument(parameter("boxed"), null, null, null));
        assertNull(resolver.resolveArgument(parameter("plain"), null, null, null));
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> resolver.resolveArgument(parameter("wrongType"), null, null, null));
        assertTrue(error.getMessage().contains("java.lang.String"));
    }

    @Test
    void modelAttributeExposesFeatureStates() {
        snapshots.setFeatures(Map.of("preview", enabled("preview"),
                "legacy", FeatureDefinition.builder().featureKey("legacy").build()));
        assertEquals(Map.of("preview", true, "legacy", false),
                new TogglyModelAttribute(client).features());
    }

    private GateResult gate(Object handler) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        boolean allowed = new FeatureGateInterceptor(client)
                .preHandle(new MockHttpServletRequest(), response, handler);
        return new GateResult(allowed, response.getStatus());
    }

    private static FeatureDefinition enabled(String key) {
        return FeatureDefinition.builder().featureKey(key)
                .filters(List.of(FeatureFilter.alwaysOn())).build();
    }

    private static HandlerMethod handler(Class<?> type, String name) throws Exception {
        Method method = type.getMethod(name);
        return new HandlerMethod(type.getDeclaredConstructor().newInstance(), method);
    }

    private static MethodParameter parameter(String name) throws NoSuchMethodException {
        Class<?> type = name.equals("wrongType") ? String.class
                : name.equals("boxed") ? Boolean.class : boolean.class;
        return new MethodParameter(ControllerParameters.class.getMethod(name, type), 0);
    }

    private record GateResult(boolean allowed, int status) {}

    static class PlainController { public void plain() {} }

    static class MethodController {
        @FeatureGate(value = {"preview", "beta"}, matchAll = false, negate = true, status = 403)
        public void preview() {}
    }

    @FeatureGate("general")
    static class ClassController {
        public void plain() {}

        @FeatureGate(value = {"preview", "beta"}, matchAll = false, negate = true, status = 403)
        public void preview() {}
    }

    static class ControllerParameters {
        public void enabled(@FeatureArgumentResolver.FeatureFlag("preview") boolean enabled) {}
        public void boxed(@FeatureArgumentResolver.FeatureFlag("preview") Boolean enabled) {}
        public void wrongType(@FeatureArgumentResolver.FeatureFlag("preview") String value) {}
        public void plain(boolean enabled) {}
    }
}
