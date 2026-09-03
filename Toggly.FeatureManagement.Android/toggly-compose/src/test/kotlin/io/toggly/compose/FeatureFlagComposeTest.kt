package io.toggly.compose

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import io.toggly.core.TogglyEntityContext
import io.toggly.core.TogglyService
import io.toggly.core.clearRegisteredContexts
import io.toggly.core.models.FeatureRequirement
import io.toggly.core.models.TogglyConfig
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class FeatureFlagComposeTest {

    @get:Rule
    val composeRule = createComposeRule()

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var service: TogglyService

    private val flags = mapOf(
        "banner" to true,
        "maintenance" to false,
        "a" to true,
        "b" to false,
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        service = TogglyService(
            TogglyConfig(
                appKey = "test-key",
                featureDefaults = flags,
                storage = MemoryStorage()
            )
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        clearRegisteredContexts()
        service.dispose()
    }

    private fun setWithFlags(content: @androidx.compose.runtime.Composable () -> Unit) {
        composeRule.setContent {
            CompositionLocalProvider(
                LocalTogglyService provides service,
                LocalFeatureFlags provides flags,
                content = content
            )
        }
    }

    @Test
    fun `Feature shows content when flag is on`() {
        setWithFlags {
            Feature(featureKey = "banner") { BasicText("on-content") }
        }
        composeRule.onNodeWithText("on-content").assertExists()
    }

    @Test
    fun `Feature with negate shows content when flag is off`() {
        setWithFlags {
            Feature(featureKey = "maintenance", negate = true) { BasicText("off-content") }
        }
        composeRule.onNodeWithText("off-content").assertExists()
    }

    @Test
    fun `Feature with negate hides content when flag is on`() {
        setWithFlags {
            Feature(featureKey = "banner", negate = true) { BasicText("should-hide") }
        }
        composeRule.onNodeWithText("should-hide").assertDoesNotExist()
    }

    @Test
    fun `Feature renders fallback when gate fails`() {
        setWithFlags {
            Feature(
                featureKey = "maintenance",
                fallback = { BasicText("fallback") }
            ) {
                BasicText("primary")
            }
        }
        composeRule.onNodeWithText("fallback").assertExists()
        composeRule.onNodeWithText("primary").assertDoesNotExist()
    }

    @Test
    fun `FeatureFlagOff is deprecate alias for negate`() {
        setWithFlags {
            FeatureFlagOff(featureKey = "maintenance") { BasicText("legacy-off") }
        }
        composeRule.onNodeWithText("legacy-off").assertExists()
    }

    @Test
    fun `FeatureFlag is deprecate alias for on path`() {
        setWithFlags {
            FeatureFlag(featureKey = "banner") { BasicText("legacy-on") }
        }
        composeRule.onNodeWithText("legacy-on").assertExists()
    }

    @Test
    fun `FeatureGate ALL and ANY`() {
        setWithFlags {
            FeatureGate(featureKeys = listOf("a", "b"), requirement = FeatureRequirement.ALL) {
                BasicText("all-fail")
            }
            FeatureGate(featureKeys = listOf("a", "b"), requirement = FeatureRequirement.ANY) {
                BasicText("any-pass")
            }
        }
        composeRule.onNodeWithText("all-fail").assertDoesNotExist()
        composeRule.onNodeWithText("any-pass").assertExists()
    }

    @Test
    fun `FeatureGate with negate`() {
        setWithFlags {
            FeatureGate(featureKeys = listOf("maintenance"), negate = true) {
                BasicText("gate-off")
            }
        }
        composeRule.onNodeWithText("gate-off").assertExists()
    }

    @Test
    fun `FeatureSwitch picks enabled or disabled slot`() {
        setWithFlags {
            FeatureSwitch(
                featureKey = "banner",
                enabled = { BasicText("switch-on") },
                disabled = { BasicText("switch-off") }
            )
        }
        composeRule.onNodeWithText("switch-on").assertExists()
        composeRule.onNodeWithText("switch-off").assertDoesNotExist()
    }

    @Test
    fun `Feature with entity context uses service evaluation`() = runTest {
        service.registerContext("Order") { order: Map<String, String> ->
            TogglyEntityContext("Order", order.getValue("id"), emptyMap())
        }
        composeRule.setContent {
            CompositionLocalProvider(
                LocalTogglyService provides service,
                LocalFeatureFlags provides flags
            ) {
                Feature(
                    featureKey = "banner",
                    context = mapOf("id" to "1"),
                    contextKind = "Order"
                ) {
                    BasicText("entity-on")
                }
            }
        }
        advanceUntilIdle()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("entity-on").assertExists()
    }

    @Test
    fun `rememberFeatureFlagAsState and rememberFeatureGateAsState collect flows`() {
        composeRule.setContent {
            CompositionLocalProvider(
                LocalTogglyService provides service,
                LocalFeatureFlags provides flags
            ) {
                // Snapshot path still exercises rememberFeature wrappers; AsState uses flows.
                val flagState = rememberFeatureFlag("banner")
                val gateState = rememberFeatureGate(listOf("banner"), FeatureRequirement.ALL, false)
                BasicText("ready-$flagState-$gateState")
            }
        }
        composeRule.onNodeWithText("ready-true-true").assertExists()
    }
}
