package io.toggly.spring.boot;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class TogglyAutoConfigurationTest {

    @Test
    void registersClientAndConfigFromProperties() {
        ApplicationContextRunner runner = new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(TogglyAutoConfiguration.class))
                .withPropertyValues(
                        "toggly.app-key=app-key",
                        "toggly.environment=Staging",
                        "toggly.enable-usage-tracking=false",
                        "toggly.enable-metrics=false");

        runner.withBean(InMemorySnapshotProvider.class, InMemorySnapshotProvider::new)
                .run(context -> {
                    assertThat(context).hasSingleBean(TogglyConfig.class);
                    assertThat(context).hasSingleBean(TogglyClient.class);
                    assertThat(context.getBean(TogglyConfig.class).getEnvironment()).isEqualTo("Staging");
                });
    }

    @Test
    void disabledWhenTogglyExplicitlyOff() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(TogglyAutoConfiguration.class))
                .withPropertyValues("toggly.enabled=false")
                .run(context -> assertThat(context).doesNotHaveBean(TogglyClient.class));
    }
}
