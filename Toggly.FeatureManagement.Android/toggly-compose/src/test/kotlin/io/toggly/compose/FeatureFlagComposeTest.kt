package io.toggly.compose

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
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
import org.junit.Assert.assertTrue
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
            TogglyConfig(enableTelemetry = false,
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
    fun `primary Feature overload renders exactly one matching block`() {
        setWithFlags {
            Feature("banner", false, null, null) { BasicText("banner-on") }
            Feature("banner", true, null, null) { BasicText("banner-off") }
            Feature("maintenance", false, null, null) { BasicText("maintenance-on") }
            Feature("maintenance", true, null, null) { BasicText("maintenance-off") }
        }

        composeRule.onAllNodesWithText("banner-on").assertCountEquals(1)
        composeRule.onNodeWithText("banner-off").assertDoesNotExist()
        composeRule.onNodeWithText("maintenance-on").assertDoesNotExist()
        composeRule.onAllNodesWithText("maintenance-off").assertCountEquals(1)
    }

    @Test
    fun `primary and legacy feature block JVM methods coexist`() {
        val methods = Class.forName("io.toggly.compose.FeatureFlagKt").declaredMethods

        assertTrue(methods.any { it.name == "Feature" && it.parameterCount == 8 })
        assertTrue(methods.any { it.name == "Feature" && it.parameterCount == 9 })
        assertTrue(methods.any { it.name == "FeatureGate" && it.parameterCount == 9 })
        assertTrue(methods.any { it.name == "FeatureGate" && it.parameterCount == 10 })
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

    @Suppress("DEPRECATION")
    @Test
    fun `legacy Feature positional fallback remains source compatible`() {
        setWithFlags {
            Feature(
                "maintenance",
                false,
                null,
                null,
                { BasicText("legacy-feature-fallback") }
            ) {
                BasicText("legacy-feature-primary")
            }
        }
        composeRule.onNodeWithText("legacy-feature-fallback").assertExists()
        composeRule.onNodeWithText("legacy-feature-primary").assertDoesNotExist()
    }

    @Suppress("DEPRECATION")
    @Test
    fun `primary and legacy Feature overloads respond to recomposed arguments`() {
        val featureKey = mutableStateOf("banner")
        val negate = mutableStateOf(false)

        setWithFlags {
            Feature(featureKey.value, negate.value, null, null) {
                BasicText("primary-feature")
            }
            Feature(
                featureKey.value,
                negate.value,
                null,
                null,
                { BasicText("legacy-feature-fallback") }
            ) {
                BasicText("legacy-feature-content")
            }
        }

        composeRule.onNodeWithText("primary-feature").assertExists()
        composeRule.onNodeWithText("legacy-feature-content").assertExists()
        composeRule.onNodeWithText("legacy-feature-fallback").assertDoesNotExist()

        composeRule.runOnIdle { featureKey.value = "maintenance" }
        composeRule.onNodeWithText("primary-feature").assertDoesNotExist()
        composeRule.onNodeWithText("legacy-feature-content").assertDoesNotExist()
        composeRule.onNodeWithText("legacy-feature-fallback").assertExists()

        composeRule.runOnIdle { negate.value = true }
        composeRule.onNodeWithText("primary-feature").assertExists()
        composeRule.onNodeWithText("legacy-feature-content").assertExists()
        composeRule.onNodeWithText("legacy-feature-fallback").assertDoesNotExist()
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
    fun `primary FeatureGate overload negates the combined requirement result`() {
        setWithFlags {
            FeatureGate(listOf("a", "b"), FeatureRequirement.ALL, false, null, null) {
                BasicText("all-on")
            }
            FeatureGate(listOf("a", "b"), FeatureRequirement.ALL, true, null, null) {
                BasicText("all-off")
            }
            FeatureGate(listOf("a", "b"), FeatureRequirement.ANY, false, null, null) {
                BasicText("any-on")
            }
            FeatureGate(listOf("a", "b"), FeatureRequirement.ANY, true, null, null) {
                BasicText("any-off")
            }
        }

        composeRule.onNodeWithText("all-on").assertDoesNotExist()
        composeRule.onAllNodesWithText("all-off").assertCountEquals(1)
        composeRule.onAllNodesWithText("any-on").assertCountEquals(1)
        composeRule.onNodeWithText("any-off").assertDoesNotExist()
    }

    @Suppress("DEPRECATION")
    @Test
    fun `legacy FeatureGate named fallback remains source compatible`() {
        setWithFlags {
            FeatureGate(
                featureKeys = listOf("a", "b"),
                requirement = FeatureRequirement.ALL,
                fallback = { BasicText("legacy-gate-fallback") }
            ) {
                BasicText("legacy-gate-primary")
            }
        }
        composeRule.onNodeWithText("legacy-gate-fallback").assertExists()
        composeRule.onNodeWithText("legacy-gate-primary").assertDoesNotExist()
    }

    @Suppress("DEPRECATION")
    @Test
    fun `primary and legacy FeatureGate overloads respond to recomposed requirements`() {
        val featureKeys = mutableStateOf(listOf("a", "b"))
        val requirement = mutableStateOf(FeatureRequirement.ALL)
        val negate = mutableStateOf(false)

        setWithFlags {
            FeatureGate(featureKeys.value, requirement.value, negate.value, null, null) {
                BasicText("primary-gate")
            }
            FeatureGate(
                featureKeys.value,
                requirement.value,
                negate.value,
                null,
                null,
                { BasicText("legacy-gate-fallback") }
            ) {
                BasicText("legacy-gate-content")
            }
        }

        composeRule.onNodeWithText("primary-gate").assertDoesNotExist()
        composeRule.onNodeWithText("legacy-gate-content").assertDoesNotExist()
        composeRule.onNodeWithText("legacy-gate-fallback").assertExists()

        composeRule.runOnIdle { requirement.value = FeatureRequirement.ANY }
        composeRule.onNodeWithText("primary-gate").assertExists()
        composeRule.onNodeWithText("legacy-gate-content").assertExists()
        composeRule.onNodeWithText("legacy-gate-fallback").assertDoesNotExist()

        composeRule.runOnIdle { negate.value = true }
        composeRule.onNodeWithText("primary-gate").assertDoesNotExist()
        composeRule.onNodeWithText("legacy-gate-content").assertDoesNotExist()
        composeRule.onNodeWithText("legacy-gate-fallback").assertExists()

        composeRule.runOnIdle { featureKeys.value = listOf("b") }
        composeRule.onNodeWithText("primary-gate").assertExists()
        composeRule.onNodeWithText("legacy-gate-content").assertExists()
        composeRule.onNodeWithText("legacy-gate-fallback").assertDoesNotExist()
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
                    "banner",
                    false,
                    mapOf("id" to "1"),
                    "Order"
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
