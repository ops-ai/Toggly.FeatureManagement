package io.toggly.spring.boot;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FeatureAspectTest {

    @Test
    void enabledGateProceedsAndAnyGateAcceptsOneEnabledFeature() {
        try (TogglyClient client = client()) {
            FeatureService service = proxy(client);

            assertThat(service.enabled()).isEqualTo("new");
            assertThat(service.anyEnabled()).isEqualTo("new");
            assertThat(service.allEnabled()).isEqualTo("old");
        }
    }

    @Test
    void disabledGateInvokesFallbackWithOriginalArguments() {
        try (TogglyClient client = client()) {
            assertThat(proxy(client).withFallback("receipt-17"))
                    .isEqualTo("legacy:receipt-17");
        }
    }

    @Test
    void disabledGateReturnsTypedConfiguredAndPrimitiveDefaults() {
        try (TogglyClient client = client()) {
            FeatureService service = proxy(client);

            assertThat(service.booleanValue()).isTrue();
            assertThat(service.integerValue()).isEqualTo(7);
            assertThat(service.longValue()).isEqualTo(9L);
            assertThat(service.doubleValue()).isEqualTo(2.5);
            assertThat(service.stringValue()).isEqualTo("legacy");
            assertThat(service.emptyBoolean()).isFalse();
            assertThat(service.emptyInteger()).isZero();
            assertThat(service.emptyLong()).isZero();
            assertThat(service.emptyDouble()).isZero();
            assertThat(service.emptyFloat()).isZero();
            assertThat(service.emptyShort()).isZero();
            assertThat(service.emptyByte()).isZero();
            assertThat(service.emptyChar()).isEqualTo('\0');
            assertThat(service.emptyReference()).isNull();
            assertThat(service.unsupportedValue()).isNull();
            assertThat(service.voidValue()).isNull();
        }
    }

    @Test
    void missingFallbackReportsItsContractFailure() {
        try (TogglyClient client = client()) {
            FeatureService service = proxy(client);
            assertThatThrownBy(service::missingFallback)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("missing")
                    .hasMessageContaining("matching signature");
        }
    }

    private static FeatureService proxy(TogglyClient client) {
        AspectJProxyFactory factory = new AspectJProxyFactory(new FeatureService());
        factory.addAspect(new FeatureAspect(client));
        return factory.getProxy();
    }

    private static TogglyClient client() {
        TogglyConfig config = TogglyConfig.builder().appKey("test-key")
                .enableUsageTracking(false).enableMetrics(false)
                .registerContextsOnStartup(false).build();
        FeatureDefinition enabled = FeatureDefinition.builder()
                .featureKey("first").addFilter(FeatureFilter.alwaysOn()).build();
        FeatureDefinition disabled = FeatureDefinition.builder()
                .featureKey("second").build();
        return new TogglyClient(config,
                new InMemorySnapshotProvider(Map.of("first", enabled, "second", disabled)));
    }

    public static class FeatureService {
        @FeatureEnabled("first")
        public String enabled() { return "new"; }

        @FeatureEnabled(value = {"first", "second"}, matchAll = false)
        public String anyEnabled() { return "new"; }

        @FeatureEnabled(value = {"first", "second"}, fallbackMethod = "old")
        public String allEnabled() { return "new"; }

        public String old() { return "old"; }

        @FeatureEnabled(value = "second", fallbackMethod = "oldWithArgument")
        public String withFallback(String receipt) { return "new:" + receipt; }

        public String oldWithArgument(String receipt) { return "legacy:" + receipt; }

        @FeatureEnabled(value = "second", fallbackMethod = "missing")
        public String missingFallback() { return "new"; }

        @FeatureEnabled(value = "second", defaultValue = "true")
        public boolean booleanValue() { return false; }

        @FeatureEnabled(value = "second", defaultValue = "7")
        public int integerValue() { return -1; }

        @FeatureEnabled(value = "second", defaultValue = "9")
        public long longValue() { return -1; }

        @FeatureEnabled(value = "second", defaultValue = "2.5")
        public double doubleValue() { return -1; }

        @FeatureEnabled(value = "second", defaultValue = "legacy")
        public String stringValue() { return "new"; }

        @FeatureEnabled("second")
        public boolean emptyBoolean() { return true; }

        @FeatureEnabled("second")
        public int emptyInteger() { return -1; }

        @FeatureEnabled("second")
        public long emptyLong() { return -1; }

        @FeatureEnabled("second")
        public double emptyDouble() { return -1; }

        @FeatureEnabled("second")
        public float emptyFloat() { return -1; }

        @FeatureEnabled("second")
        public short emptyShort() { return -1; }

        @FeatureEnabled("second")
        public byte emptyByte() { return -1; }

        @FeatureEnabled("second")
        public char emptyChar() { return 'x'; }

        @FeatureEnabled("second")
        public Object emptyReference() { return new Object(); }

        @FeatureEnabled(value = "second", defaultValue = "ignored")
        public Object unsupportedValue() { return new Object(); }

        @FeatureEnabled("second")
        public Void voidValue() { return null; }
    }
}
