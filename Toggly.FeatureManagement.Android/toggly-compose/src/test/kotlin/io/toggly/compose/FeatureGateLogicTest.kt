package io.toggly.compose

import io.toggly.core.models.FeatureRequirement
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FeatureGateLogicTest {

    @Test
    fun `empty gate always passes`() {
        assertTrue(
            evaluateSnapshotFeatureGate(emptyMap(), emptyList(), FeatureRequirement.ALL, negate = false)
        )
        assertTrue(
            evaluateSnapshotFeatureGate(emptyMap(), emptyList(), FeatureRequirement.ALL, negate = true)
        )
    }

    @Test
    fun `ALL requires every flag on`() {
        val flags = mapOf("a" to true, "b" to true, "c" to false)
        assertTrue(evaluateSnapshotFeatureGate(flags, listOf("a", "b"), FeatureRequirement.ALL, false))
        assertFalse(evaluateSnapshotFeatureGate(flags, listOf("a", "c"), FeatureRequirement.ALL, false))
        assertFalse(evaluateSnapshotFeatureGate(flags, listOf("missing"), FeatureRequirement.ALL, false))
    }

    @Test
    fun `ANY requires at least one flag on`() {
        val flags = mapOf("a" to false, "b" to true)
        assertTrue(evaluateSnapshotFeatureGate(flags, listOf("a", "b"), FeatureRequirement.ANY, false))
        assertFalse(evaluateSnapshotFeatureGate(flags, listOf("a"), FeatureRequirement.ANY, false))
    }

    @Test
    fun `negate inverts snapshot result`() {
        val flags = mapOf("on" to true, "off" to false)
        assertFalse(evaluateSnapshotFeatureGate(flags, listOf("on"), FeatureRequirement.ALL, true))
        assertTrue(evaluateSnapshotFeatureGate(flags, listOf("off"), FeatureRequirement.ALL, true))
    }
}
