package io.toggly.core

import org.junit.Assert.assertEquals
import org.junit.Test

class SystemMetricsCollectorTest {
    @Test
    fun emitsInjectedSamples() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
            sampler = { listOf("ExceptionCount" to 3.0) },
        )
        collector.start()
        collector.tick()
        collector.stop()
        assertEquals(listOf("ExceptionCount" to 3.0), observed)
    }
}
