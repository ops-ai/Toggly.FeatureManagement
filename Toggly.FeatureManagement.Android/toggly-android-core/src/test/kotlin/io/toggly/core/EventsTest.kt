package io.toggly.core

import io.toggly.core.models.*
import org.junit.Assert.*
import org.junit.Test

class EventsTest {

    @Test
    fun `Initialized event contains response`() {
        val flags: FeatureFlags = mapOf("feature1" to true, "feature2" to false)
        val response = TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = flags)
        val event = TogglyEvent.Initialized(response)

        assertEquals(response, event.response)
        assertEquals(flags, event.response.flags)
        assertTrue(event is TogglyEvent)
    }

    @Test
    fun `Refreshed event contains feature flags`() {
        val flags: FeatureFlags = mapOf("newFeature" to true)
        val event = TogglyEvent.Refreshed(flags)

        assertEquals(flags, event.flags)
    }

    @Test
    fun `Error event contains message and cause`() {
        val cause = RuntimeException("Test error")
        val event = TogglyEvent.Error("Error occurred", cause)

        assertEquals("Error occurred", event.message)
        assertEquals(cause, event.cause)
    }

    @Test
    fun `Error event with null cause`() {
        val event = TogglyEvent.Error("Simple error")

        assertEquals("Simple error", event.message)
        assertNull(event.cause)
    }

    @Test
    fun `IdentityChanged event contains previous and new identity`() {
        val event = TogglyEvent.IdentityChanged(
            previousIdentity = "user-123",
            newIdentity = "user-456"
        )

        assertEquals("user-123", event.previousIdentity)
        assertEquals("user-456", event.newIdentity)
    }

    @Test
    fun `IdentityChanged event handles null previous identity`() {
        val event = TogglyEvent.IdentityChanged(
            previousIdentity = null,
            newIdentity = "user-123"
        )
        assertNull(event.previousIdentity)
        assertEquals("user-123", event.newIdentity)
    }

    @Test
    fun `FeatureChanged event contains all fields`() {
        val event = TogglyEvent.FeatureChanged(
            featureKey = "my-feature",
            previousValue = false,
            newValue = true
        )

        assertEquals("my-feature", event.featureKey)
        assertEquals(false, event.previousValue)
        assertEquals(true, event.newValue)
    }

    @Test
    fun `FeatureChanged event with nullable values`() {
        val event = TogglyEvent.FeatureChanged(
            featureKey = "new-feature",
            previousValue = null,
            newValue = true
        )

        assertEquals("new-feature", event.featureKey)
        assertNull(event.previousValue)
        assertEquals(true, event.newValue)
    }

    @Test
    fun `NetworkChanged event contains network state`() {
        val state = NetworkState(isConnected = true, connectionType = "wifi")
        val event = TogglyEvent.NetworkChanged(state)

        assertTrue(event.state.isConnected)
        assertEquals("wifi", event.state.connectionType)

        val offlineState = NetworkState(isConnected = false)
        val offlineEvent = TogglyEvent.NetworkChanged(offlineState)
        assertFalse(offlineEvent.state.isConnected)
    }

    @Test
    fun `AppStateChanged event contains app state`() {
        val foregroundEvent = TogglyEvent.AppStateChanged(AppStateType.ACTIVE)
        assertEquals(AppStateType.ACTIVE, foregroundEvent.state)

        val backgroundEvent = TogglyEvent.AppStateChanged(AppStateType.BACKGROUND)
        assertEquals(AppStateType.BACKGROUND, backgroundEvent.state)

        val inactiveEvent = TogglyEvent.AppStateChanged(AppStateType.INACTIVE)
        assertEquals(AppStateType.INACTIVE, inactiveEvent.state)
    }

    @Test
    fun `events are sealed class instances`() {
        val response = TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = emptyMap())
        val events: List<TogglyEvent> = listOf(
            TogglyEvent.Initialized(response),
            TogglyEvent.Refreshed(emptyMap()),
            TogglyEvent.Error("error message"),
            TogglyEvent.IdentityChanged(null, "user-1"),
            TogglyEvent.FeatureChanged("key", null, true),
            TogglyEvent.NetworkChanged(NetworkState(true)),
            TogglyEvent.AppStateChanged(AppStateType.ACTIVE)
        )

        events.forEach { event ->
            assertTrue(event is TogglyEvent)
        }

        assertEquals(7, events.size)
    }

    @Test
    fun `when expression covers all event types`() {
        val response = TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = emptyMap())
        val events: List<TogglyEvent> = listOf(
            TogglyEvent.Initialized(response),
            TogglyEvent.Refreshed(emptyMap()),
            TogglyEvent.Error("error"),
            TogglyEvent.IdentityChanged(null, "user-1"),
            TogglyEvent.FeatureChanged("key", null, true),
            TogglyEvent.NetworkChanged(NetworkState(true)),
            TogglyEvent.AppStateChanged(AppStateType.ACTIVE)
        )

        events.forEach { event ->
            val result = when (event) {
                is TogglyEvent.Initialized -> "initialized"
                is TogglyEvent.Refreshed -> "refreshed"
                is TogglyEvent.Error -> "error"
                is TogglyEvent.IdentityChanged -> "identity"
                is TogglyEvent.FeatureChanged -> "feature"
                is TogglyEvent.NetworkChanged -> "network"
                is TogglyEvent.AppStateChanged -> "app"
            }
            assertNotNull(result)
        }
    }

    @Test
    fun `Initialized event with empty flags`() {
        val response = TogglyInitResponse(status = TogglyLoadStatus.DEFAULTS, flags = emptyMap())
        val event = TogglyEvent.Initialized(response)
        assertTrue(event.response.flags.isEmpty())
    }

    @Test
    fun `Initialized event with many flags`() {
        val flags = (1..100).associate { "feature$it" to (it % 2 == 0) }
        val response = TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = flags)
        val event = TogglyEvent.Initialized(response)

        assertEquals(100, event.response.flags.size)
        assertTrue(event.response.flags["feature2"]!!)
        assertFalse(event.response.flags["feature1"]!!)
    }

    @Test
    fun `Error event with nested exception`() {
        val cause = IllegalArgumentException("Root cause")
        val wrapper = RuntimeException("Wrapper", cause)
        val event = TogglyEvent.Error("Wrapper error", wrapper)

        assertEquals("Wrapper error", event.message)
        assertEquals(wrapper, event.cause)
        assertEquals(cause, event.cause?.cause)
    }

    @Test
    fun `FeatureChanged event for same value`() {
        val event = TogglyEvent.FeatureChanged(
            featureKey = "feature",
            previousValue = true,
            newValue = true
        )

        assertEquals(event.previousValue, event.newValue)
    }

    @Test
    fun `events have correct toString representation`() {
        val response = TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = mapOf("f" to true))
        val initialized = TogglyEvent.Initialized(response)
        assertTrue(initialized.toString().isNotEmpty())

        val error = TogglyEvent.Error("test error")
        assertTrue(error.toString().isNotEmpty())
    }

    @Test
    fun `FeatureChanged event with special characters in key`() {
        val event = TogglyEvent.FeatureChanged(
            featureKey = "feature:with/special\\chars",
            previousValue = false,
            newValue = true
        )

        assertEquals("feature:with/special\\chars", event.featureKey)
    }

    @Test
    fun `TogglyLoadStatus enum values`() {
        assertEquals(3, TogglyLoadStatus.entries.size)
        assertTrue(TogglyLoadStatus.entries.contains(TogglyLoadStatus.FETCHED))
        assertTrue(TogglyLoadStatus.entries.contains(TogglyLoadStatus.CACHED))
        assertTrue(TogglyLoadStatus.entries.contains(TogglyLoadStatus.DEFAULTS))
    }

    @Test
    fun `AppStateType enum values`() {
        assertEquals(3, AppStateType.entries.size)
        assertTrue(AppStateType.entries.contains(AppStateType.ACTIVE))
        assertTrue(AppStateType.entries.contains(AppStateType.INACTIVE))
        assertTrue(AppStateType.entries.contains(AppStateType.BACKGROUND))
    }
}
