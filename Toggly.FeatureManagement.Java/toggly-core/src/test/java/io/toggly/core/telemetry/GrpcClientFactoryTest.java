package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GrpcClientFactoryTest {

    @Test
    void parsesMetricsBaseUrlIntoHostPort() {
        assertThat(GrpcClientFactory.grpcTarget("https://app.toggly.io/")).isEqualTo("app.toggly.io:443");
        assertThat(GrpcClientFactory.grpcTarget("https://localhost:5001")).isEqualTo("localhost:5001");
        assertThat(GrpcClientFactory.grpcTarget("app.toggly.io")).isEqualTo("app.toggly.io:443");
    }

    @Test
    void isAvailableWhenOptionalGrpcDepsPresent() {
        assertThat(GrpcClientFactory.isAvailable()).isTrue();
    }

    @Test
    void createReturnsClientsWhenGrpcPresent() {
        GrpcClients clients = GrpcClientFactory.create("https://app.toggly.io/");
        assertThat(clients).isNotNull();
        clients.close();
    }
}
