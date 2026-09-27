package io.toggly.views

import android.content.Context
import android.view.View
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.test.core.app.ApplicationProvider
import io.mockk.every
import io.mockk.mockk
import io.toggly.core.TogglyService
import io.toggly.core.models.FeatureRequirement
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class ViewExtensionsTest {
    private class ActiveOwner : LifecycleOwner {
        val registry = LifecycleRegistry(this)
        override val lifecycle: Lifecycle = registry
    }

    private val dispatcher = UnconfinedTestDispatcher()
    private val service = mockk<TogglyService>()
    private lateinit var owner: ActiveOwner
    private lateinit var context: Context

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        owner = ActiveOwner()
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        context = ApplicationProvider.getApplicationContext()
    }

    @After
    fun tearDown() {
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
        Dispatchers.resetMain()
    }

    @Test
    fun `flag visibility follows disabled and enabled states with caller's visibility choices`() {
        val flag = MutableStateFlow(false)
        every { service.featureFlagFlow("checkout") } returns flag
        val view = View(context)

        view.bindToFeatureFlag("checkout", owner, service, View.VISIBLE, View.INVISIBLE)
        assertEquals(View.INVISIBLE, view.visibility)

        flag.value = true
        assertEquals(View.VISIBLE, view.visibility)
    }

    @Test
    fun `enabled and alpha bindings follow feature transitions`() {
        val flag = MutableStateFlow(false)
        every { service.featureFlagFlow("checkout") } returns flag
        val enabledView = View(context)
        val alphaView = View(context)

        enabledView.bindEnabledToFeatureFlag("checkout", owner, service)
        alphaView.bindAlphaToFeatureFlag("checkout", owner, service, 0.9f, 0.2f)
        assertEquals(false, enabledView.isEnabled)
        assertEquals(0.2f, alphaView.alpha)

        flag.value = true
        assertEquals(true, enabledView.isEnabled)
        assertEquals(0.9f, alphaView.alpha)
    }

    @Test
    fun `gate binding follows a negated ANY gate and cancellation stops changes`() {
        val gate = MutableStateFlow(false)
        every { service.featureGateFlow(listOf("a", "b"), FeatureRequirement.ANY, true) } returns gate
        val view = View(context)

        val binding = view.bindToFeatureGate(
            listOf("a", "b"), owner, FeatureRequirement.ANY, true, service,
            View.INVISIBLE, View.GONE
        )
        assertEquals(View.GONE, view.visibility)

        gate.value = true
        assertEquals(View.INVISIBLE, view.visibility)
        binding.cancel()
        gate.value = false
        assertEquals(View.INVISIBLE, view.visibility)
    }

    @Test
    fun `on and off helpers show opposite views for the same feature`() {
        val on = MutableStateFlow(false)
        val off = MutableStateFlow(true)
        every { service.featureGateFlow(listOf("checkout"), FeatureRequirement.ALL, false) } returns on
        every { service.featureGateFlow(listOf("checkout"), FeatureRequirement.ALL, true) } returns off
        val enabledView = View(context)
        val disabledView = View(context)

        enabledView.showWhenFeatureEnabled("checkout", owner, service)
        disabledView.showWhenFeatureDisabled("checkout", owner, service)
        assertEquals(View.GONE, enabledView.visibility)
        assertEquals(View.VISIBLE, disabledView.visibility)

        on.value = true
        off.value = false
        assertEquals(View.VISIBLE, enabledView.visibility)
        assertEquals(View.GONE, disabledView.visibility)
    }

    @Test
    fun `toggleViews swaps visibility when the feature changes`() {
        val flag = MutableStateFlow(false)
        every { service.featureFlagFlow("checkout") } returns flag
        val enabledView = View(context)
        val disabledView = View(context)

        toggleViews("checkout", owner, enabledView, disabledView, service)
        assertEquals(View.GONE, enabledView.visibility)
        assertEquals(View.VISIBLE, disabledView.visibility)

        flag.value = true
        assertEquals(View.VISIBLE, enabledView.visibility)
        assertEquals(View.GONE, disabledView.visibility)
    }
}
