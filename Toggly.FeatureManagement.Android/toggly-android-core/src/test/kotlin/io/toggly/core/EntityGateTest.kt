package io.toggly.core

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EntityGateTest {
    private val datetimeGate = EntityGate(
        requirement = "all",
        rules = listOf(
            EntityGateRule(property = "BirthDate", op = "gt", value = "2026-01-01", type = "datetime")
        )
    )

    @After
    fun tearDown() {
        clearRegisteredContexts()
    }

    @Test
    fun `detects entity gates`() {
        assertFalse(isEntityGate(true))
        assertTrue(isEntityGate(datetimeGate))
    }

    @Test
    fun `fails closed without context`() {
        assertFalse(resolveEvaluatedDefinition(EvaluatedDefinition.Gate(datetimeGate)))
    }

    @Test
    fun `falls back to default for absent definition`() {
        assertFalse(resolveEvaluatedDefinition(null))
        assertTrue(resolveEvaluatedDefinition(null, defaultValue = true))
        assertFalse(resolveEvaluatedDefinition(EvaluatedDefinition.BooleanValue(false), defaultValue = true))
        assertFalse(resolveEvaluatedDefinition(EvaluatedDefinition.Gate(datetimeGate), defaultValue = true))
    }

    @Test
    fun `evaluates datetime gt locally`() {
        val enabled = resolveEvaluatedDefinition(
            EvaluatedDefinition.Gate(datetimeGate),
            TogglyEntityContext("Order", "1", mapOf("BirthDate" to "2026-06-15T00:00:00Z"))
        )
        assertTrue(enabled)
    }

    @Test
    fun `flattens mixed definitions`() {
        val flattened = toBooleanDefinitions(
            mapOf(
                "On" to EvaluatedDefinition.BooleanValue(true),
                "Off" to EvaluatedDefinition.BooleanValue(false),
                "Gated" to EvaluatedDefinition.Gate(datetimeGate)
            )
        )
        assertEquals(mapOf("On" to true, "Off" to false, "Gated" to false), flattened)
    }

    @Test
    fun `evaluates any all requirements`() {
        val gate = EntityGate(
            requirement = "any",
            rules = listOf(
                EntityGateRule("Color", "eq", "red"),
                EntityGateRule("Color", "eq", "blue")
            )
        )
        assertTrue(applyEntityGate(gate, mapOf("Color" to "blue")))
        assertFalse(applyEntityGate(gate.copy(requirement = "all"), mapOf("Color" to "blue")))
    }

    @Test
    fun `fails closed on missing attr unknown op empty rules`() {
        assertFalse(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Color", "neq", "red"))),
                emptyMap()
            )
        )
        assertFalse(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Color", "matches", "red"))),
                mapOf("Color" to "red")
            )
        )
        assertFalse(applyEntityGate(EntityGate("all", emptyList()), mapOf("Color" to "red")))
        assertFalse(applyEntityGate(EntityGate("any", emptyList()), mapOf("Color" to "red")))
    }

    @Test
    fun `does not treat string ordered compares as numbers`() {
        assertFalse(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Code", "gt", "9"))),
                mapOf("Color" to "10", "Code" to "10")
            )
        )
    }

    @Test
    fun `compares equality in contains numbers datetimes case-insensitively`() {
        assertTrue(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("color", "eq", "RED"))),
                mapOf("Color" to "red")
            )
        )
        assertTrue(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Age", "gte", "2", "number"))),
                mapOf("Age" to 2)
            )
        )
        assertTrue(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Age", "lt", "2", "number"))),
                mapOf("Age" to "1.5")
            )
        )
        assertFalse(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Age", "lte", "2", "number"))),
                mapOf("Age" to 3)
            )
        )
        assertTrue(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Born", "gt", "2026-01-01", "datetime"))),
                mapOf("Born" to "2026-06-01T00:00:00Z")
            )
        )
        assertFalse(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Born", "gt", "not-a-date", "datetime"))),
                mapOf("Born" to "2026-06-01T00:00:00Z")
            )
        )
        assertTrue(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Color", "in", "red, blue"))),
                mapOf("Color" to "BLUE")
            )
        )
        assertTrue(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Name", "contains", "ord"))),
                mapOf("Name" to "Order")
            )
        )
        assertTrue(
            applyEntityGate(
                EntityGate("all", listOf(EntityGateRule("Tags", "contains", "beta", "string[]"))),
                mapOf("Tags" to listOf("GA", "Beta"))
            )
        )
    }

    @Test
    fun `parses mixed definitions json`() {
        val raw = """{"On":true,"Gated":{"requirement":"all","rules":[{"property":"Color","op":"eq","value":"red"}]}}"""
        val parsed = parseEvaluatedDefinitions(raw)
        assertTrue(parsed["On"] is EvaluatedDefinition.BooleanValue)
        assertTrue(parsed["Gated"] is EvaluatedDefinition.Gate)
        assertEquals(mapOf("On" to true, "Gated" to false), toBooleanDefinitions(parsed))
        assertEquals(
            true,
            resolveEvaluatedDefinition(
                parsed["Gated"],
                TogglyEntityContext("Order", "1", mapOf("Color" to "red"))
            )
        )
    }

    @Test
    fun `registerContext maps entities locally`() {
        registerContext("Order") { order: Map<String, String> ->
            TogglyEntityContext("Order", order.getValue("id"), mapOf("Color" to order["color"]))
        }
        val mapped = mapEntityContext("Order", mapOf("id" to "1", "color" to "red"))
        assertEquals("1", mapped?.key)
        assertNull(resolveEntityContext("Kitten", mapOf("id" to "1")))
    }
}
