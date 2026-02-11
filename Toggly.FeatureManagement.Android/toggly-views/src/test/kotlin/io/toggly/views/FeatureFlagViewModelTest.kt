package io.toggly.views

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import io.mockk.*
import io.toggly.core.TogglyService
import io.toggly.core.models.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FeatureFlagViewModelTest {

    @get:Rule
    val instantTaskExecutorRule = InstantTaskExecutorRule()

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var mockService: TogglyService
    private lateinit var eventsFlow: MutableSharedFlow<TogglyEvent>
    private lateinit var featureFlagsFlow: MutableStateFlow<FeatureFlags>

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        eventsFlow = MutableSharedFlow()
        featureFlagsFlow = MutableStateFlow(emptyMap())
        mockService = mockk(relaxed = true)

        every { mockService.events } returns eventsFlow
        every { mockService.featureFlags } returns featureFlagsFlow
        every { mockService.currentIdentity } returns null
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `viewModel initializes with service`() {
        val viewModel = FeatureFlagViewModel(mockService)
        assertNotNull(viewModel)
    }

    @Test
    fun `isInitialized starts as false`() {
        val viewModel = FeatureFlagViewModel(mockService)
        assertEquals(false, viewModel.isInitialized.value)
    }

    @Test
    fun `isInitialized becomes true after Initialized event`() = runTest {
        val viewModel = FeatureFlagViewModel(mockService)

        // Allow the ViewModel's init block coroutine to start collecting
        advanceUntilIdle()

        val response = TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = emptyMap())
        eventsFlow.emit(TogglyEvent.Initialized(response))
        advanceUntilIdle()

        assertEquals(true, viewModel.isInitialized.value)
    }

    @Test
    fun `featureFlags returns service featureFlags`() {
        featureFlagsFlow.value = mapOf("feature1" to true)
        val viewModel = FeatureFlagViewModel(mockService)

        assertEquals(featureFlagsFlow, viewModel.featureFlags)
    }

    @Test
    fun `currentIdentity returns service identity`() {
        every { mockService.currentIdentity } returns "user-123"
        val viewModel = FeatureFlagViewModel(mockService)

        assertEquals("user-123", viewModel.currentIdentity)
    }

    @Test
    fun `currentIdentity returns null when not set`() {
        every { mockService.currentIdentity } returns null
        val viewModel = FeatureFlagViewModel(mockService)

        assertNull(viewModel.currentIdentity)
    }

    @Test
    fun `initialize calls service init`() = runTest {
        coEvery { mockService.init() } returns TogglyInitResponse(
            status = TogglyLoadStatus.FETCHED,
            flags = emptyMap()
        )
        val viewModel = FeatureFlagViewModel(mockService)

        viewModel.initialize()
        advanceUntilIdle()

        coVerify(exactly = 1) { mockService.init() }
    }

    @Test
    fun `refresh calls service refresh`() = runTest {
        coEvery { mockService.refresh() } returns TogglyInitResponse(
            status = TogglyLoadStatus.FETCHED,
            flags = emptyMap()
        )
        val viewModel = FeatureFlagViewModel(mockService)

        viewModel.refresh()
        advanceUntilIdle()

        coVerify(exactly = 1) { mockService.refresh() }
    }

    @Test
    fun `featureFlagFlow returns service flow`() {
        every { mockService.featureFlagFlow("feature1") } returns flowOf(true)
        val viewModel = FeatureFlagViewModel(mockService)

        val flow = viewModel.featureFlagFlow("feature1")
        assertNotNull(flow)

        verify(exactly = 1) { mockService.featureFlagFlow("feature1") }
    }

    @Test
    fun `featureGateFlow returns service flow`() {
        val keys = listOf("f1", "f2")
        every {
            mockService.featureGateFlow(keys, FeatureRequirement.ALL, false)
        } returns flowOf(true)

        val viewModel = FeatureFlagViewModel(mockService)
        val flow = viewModel.featureGateFlow(keys, FeatureRequirement.ALL, false)

        assertNotNull(flow)
        verify(exactly = 1) { mockService.featureGateFlow(keys, FeatureRequirement.ALL, false) }
    }

    @Test
    fun `featureGateFlow with ANY requirement`() {
        val keys = listOf("f1", "f2")
        every {
            mockService.featureGateFlow(keys, FeatureRequirement.ANY, false)
        } returns flowOf(true)

        val viewModel = FeatureFlagViewModel(mockService)
        viewModel.featureGateFlow(keys, FeatureRequirement.ANY, false)

        verify(exactly = 1) { mockService.featureGateFlow(keys, FeatureRequirement.ANY, false) }
    }

    @Test
    fun `featureGateFlow with negate`() {
        val keys = listOf("f1")
        every {
            mockService.featureGateFlow(keys, FeatureRequirement.ALL, true)
        } returns flowOf(false)

        val viewModel = FeatureFlagViewModel(mockService)
        viewModel.featureGateFlow(keys, FeatureRequirement.ALL, true)

        verify(exactly = 1) { mockService.featureGateFlow(keys, FeatureRequirement.ALL, true) }
    }

    @Test
    fun `isFeatureOn calls service`() = runTest {
        coEvery { mockService.isFeatureOn("feature1") } returns true
        val viewModel = FeatureFlagViewModel(mockService)

        val result = viewModel.isFeatureOn("feature1")
        assertTrue(result)

        coVerify(exactly = 1) { mockService.isFeatureOn("feature1") }
    }

    @Test
    fun `isFeatureOff calls service`() = runTest {
        coEvery { mockService.isFeatureOff("feature1") } returns true
        val viewModel = FeatureFlagViewModel(mockService)

        val result = viewModel.isFeatureOff("feature1")
        assertTrue(result)

        coVerify(exactly = 1) { mockService.isFeatureOff("feature1") }
    }

    @Test
    fun `setIdentity calls service`() = runTest {
        coEvery { mockService.setIdentity("user-456") } returns TogglyInitResponse(
            status = TogglyLoadStatus.FETCHED,
            flags = emptyMap()
        )
        val viewModel = FeatureFlagViewModel(mockService)

        viewModel.setIdentity("user-456")
        advanceUntilIdle()

        coVerify(exactly = 1) { mockService.setIdentity("user-456") }
    }

    @Test
    fun `setIdentity with null calls service`() = runTest {
        coEvery { mockService.setIdentity(null) } returns TogglyInitResponse(
            status = TogglyLoadStatus.FETCHED,
            flags = emptyMap()
        )
        val viewModel = FeatureFlagViewModel(mockService)

        viewModel.setIdentity(null)
        advanceUntilIdle()

        coVerify(exactly = 1) { mockService.setIdentity(null) }
    }

    @Test
    fun `clearCache calls service`() = runTest {
        coEvery { mockService.clearCache() } just Runs
        val viewModel = FeatureFlagViewModel(mockService)

        viewModel.clearCache()
        advanceUntilIdle()

        coVerify(exactly = 1) { mockService.clearCache() }
    }

    @Test
    fun `getDebugInfo returns service debug info`() {
        val debugInfo = TogglyDebugInfo(
            identity = "user-123",
            appKey = "test-key",
            environment = "staging",
            useSignedDefinitions = false,
            isAppInForeground = true,
            refreshInterval = 180_000L,
            syncServiceRunning = false,
            lastChecked = null,
            lastSynced = null,
            eTag = null,
            lastError = null,
            networkState = null,
            appState = AppStateType.ACTIVE
        )
        every { mockService.getDebugInfo() } returns debugInfo
        val viewModel = FeatureFlagViewModel(mockService)

        val result = viewModel.getDebugInfo()

        assertEquals(debugInfo, result)
        verify(exactly = 1) { mockService.getDebugInfo() }
    }

    @Test
    fun `featureFlagLiveData returns LiveData`() {
        every { mockService.featureFlagFlow("feature1") } returns flowOf(true)
        val viewModel = FeatureFlagViewModel(mockService)

        val liveData = viewModel.featureFlagLiveData("feature1")
        assertNotNull(liveData)
    }

    @Test
    fun `featureGateLiveData returns LiveData`() {
        val keys = listOf("f1", "f2")
        every {
            mockService.featureGateFlow(keys, FeatureRequirement.ALL, false)
        } returns flowOf(true)

        val viewModel = FeatureFlagViewModel(mockService)
        val liveData = viewModel.featureGateLiveData(keys, FeatureRequirement.ALL, false)

        assertNotNull(liveData)
    }

    @Test
    fun `featureFlagsLiveData returns LiveData`() {
        val viewModel = FeatureFlagViewModel(mockService)
        val liveData = viewModel.featureFlagsLiveData

        assertNotNull(liveData)
    }
}
