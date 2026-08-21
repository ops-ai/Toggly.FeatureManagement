package io.toggly.core

import io.toggly.core.models.TogglyConfig
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Duration.Companion.seconds

class SmokeTest {

    @Test
    fun `loads live evaluated flags`() = runTest(timeout = 20.seconds) {
        val appKey = System.getenv("TOGGLY_SMOKE_APP_KEY_FRONTEND")
        if (appKey.isNullOrBlank()) {
            return@runTest
        }

        val service = TogglyService(
            TogglyConfig(
                appKey = appKey,
                environment = "Production",
                baseUri = "https://definitions.toggly.io",
                refreshInterval = 0
            )
        )

        service.init()

        assertTrue(service.isFeatureOn("FlagOn"))
        assertTrue(service.isFeatureOff("FlagOff"))
        assertFalse(service.isFeatureOn("FlagOff"))
    }

    @Test
    fun `WebSocket connects and flags are correct`() = runTest(timeout = 20.seconds) {
        val appKey = System.getenv("TOGGLY_SMOKE_APP_KEY_FRONTEND")
        if (appKey.isNullOrBlank()) {
            return@runTest
        }

        val service = TogglyService(
            TogglyConfig(
                appKey = appKey,
                environment = "Production",
                baseUri = "https://definitions.toggly.io",
                refreshInterval = 0,
                enableLiveUpdates = true
            )
        )

        service.init()

        // Brief wait for WebSocket to connect
        delay(2_000)

        assertTrue(service.isFeatureOn("FlagOn"))
        assertTrue(service.isFeatureOff("FlagOff"))
        assertFalse(service.isFeatureOn("FlagOff"))
    }
}
