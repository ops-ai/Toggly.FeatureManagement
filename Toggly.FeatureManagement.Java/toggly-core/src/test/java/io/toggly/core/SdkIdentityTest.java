package io.toggly.core;

import org.junit.jupiter.api.Test;

import java.net.URI;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class SdkIdentityTest {

    @Test
    void runtimeIdentityMatchesMavenProjectVersion() {
        String projectVersion = System.getProperty("toggly.project.version");

        assertNotNull(projectVersion, "Maven must provide the project version to this release contract test");
        assertEquals(projectVersion, SdkIdentity.SDK_VERSION);
        assertEquals("toggly-java/" + projectVersion, SdkIdentity.userAgent());
        assertEquals(projectVersion, URI.create(SdkIdentity.appendSdkQueryParams(
                "wss://definitions.toggly.io/app/ws", null)).getQuery().split("sdkVersion=")[1]);
    }
}
