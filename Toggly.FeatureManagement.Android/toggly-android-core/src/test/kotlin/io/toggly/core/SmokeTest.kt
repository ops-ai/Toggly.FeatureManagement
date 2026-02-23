package io.toggly.core

import io.toggly.core.models.TogglyConfig
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SmokeTest {

    @Test
    fun `loads live evaluated flags`() = runTest {
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
}
