package io.toggly.core

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)

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

    @Test
    fun tickBeforeStartIsNoOp() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
            sampler = { listOf("ExceptionCount" to 1.0) },
        )
        collector.tick()
        assertTrue(observed.isEmpty())
    }

    @Test
    fun startAndStopAreIdempotent() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
            sampler = { listOf("ExceptionCount" to 1.0) },
        )
        collector.start()
        collector.start()
        collector.tick()
        collector.stop()
        collector.stop()
        assertEquals(1, observed.size)
    }

    @Test
    fun skipsNonFiniteValues() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
            sampler = {
                listOf(
                    "BadNaN" to Double.NaN,
                    "BadInf" to Double.POSITIVE_INFINITY,
                    "Good" to 1.0,
                )
            },
        )
        collector.start()
        collector.tick()
        collector.stop()
        assertEquals(listOf("Good" to 1.0), observed)
    }

    @Test
    fun pendingCapBlocksFurtherObservationsUntilFlushed() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
            sampler = { listOf("CpuUsage" to 1.0) },
        )
        collector.start()
        repeat(SystemMetricsCollector.MAX_PENDING) {
            collector.tick()
        }
        collector.tick()
        assertEquals(SystemMetricsCollector.MAX_PENDING, observed.size)
        collector.onFlushed()
        collector.tick()
        assertEquals(SystemMetricsCollector.MAX_PENDING + 1, observed.size)
        collector.stop()
    }

    @Test
    fun stopClearsPending() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
            sampler = { listOf("CpuUsage" to 1.0) },
        )
        collector.start()
        repeat(SystemMetricsCollector.MAX_PENDING) {
            collector.tick()
        }
        collector.tick()
        assertEquals(SystemMetricsCollector.MAX_PENDING, observed.size)
        collector.stop()

        observed.clear()
        collector.start()
        collector.tick()
        collector.stop()
        assertEquals(1, observed.size)
    }

    @Test
    fun defaultSamplerDrainsExceptionCountViaUncaughtHandler() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
        )
        collector.start()
        val handler = Thread.getDefaultUncaughtExceptionHandler()
        handler?.uncaughtException(Thread.currentThread(), RuntimeException("test"))
        collector.tick()
        collector.stop()
        assertEquals(listOf("ExceptionCount" to 1.0), observed.filter { it.first == "ExceptionCount" })
    }

    @Test
    fun exceptionCountPreservedWhenPendingCapBlocksDrain() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
        )
        collector.start()
        val handler = Thread.getDefaultUncaughtExceptionHandler()
        repeat(SystemMetricsCollector.MAX_PENDING) {
            handler?.uncaughtException(Thread.currentThread(), RuntimeException("test"))
            collector.tick()
        }
        handler?.uncaughtException(Thread.currentThread(), RuntimeException("blocked"))
        collector.tick()
        assertEquals(SystemMetricsCollector.MAX_PENDING, observed.count { it.first == "ExceptionCount" })

        collector.onFlushed()
        collector.tick()
        assertEquals(
            SystemMetricsCollector.MAX_PENDING + 1,
            observed.count { it.first == "ExceptionCount" },
        )
        assertEquals(1.0, observed.last { it.first == "ExceptionCount" }.second, 0.0)
        collector.stop()
    }

    @Test
    fun detachUncaughtHandlerOnStopRestoresPrevious() {
        val previous = Thread.UncaughtExceptionHandler { _, _ -> }
        Thread.setDefaultUncaughtExceptionHandler(previous)
        val collector = SystemMetricsCollector(observe = { _, _ -> })
        collector.start()
        assertTrue(Thread.getDefaultUncaughtExceptionHandler() !== previous)
        collector.stop()
        assertEquals(previous, Thread.getDefaultUncaughtExceptionHandler())
    }

    @Test
    fun cpuUsageAfterTicksWithInjectedProcStat() {
        val observed = mutableListOf<Pair<String, Double>>()
        var jiffies = 1000L
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
            clockTick = { 100L },
            processorCount = { 1 },
            procStatReader = {
                val current = jiffies
                jiffies += 50
                current
            },
        )
        collector.start()
        collector.tick()
        Thread.sleep(50)
        collector.tick()
        collector.stop()
        val cpuSamples = observed.filter { it.first == "CpuUsage" }.map { it.second }
        assertFalse(cpuSamples.isEmpty())
        cpuSamples.forEach { value ->
            assertTrue(value.isFinite())
            assertTrue(value >= 0.0)
            assertTrue(value <= 100.0)
        }
    }

    @Test
    fun procStatReaderNullSkipsCpuUsage() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
            procStatReader = { null },
        )
        collector.start()
        collector.tick()
        collector.stop()
        assertFalse(observed.any { it.first == "CpuUsage" })
    }

    @Test
    fun wrappedUncaughtHandlerKeepsPreviousForForwarding() {
        var previousCalled = false
        val previous = Thread.UncaughtExceptionHandler { _, _ -> previousCalled = true }
        Thread.setDefaultUncaughtExceptionHandler(previous)
        val collector = SystemMetricsCollector(observe = { _, _ -> })
        collector.start()
        val ours = Thread.getDefaultUncaughtExceptionHandler()!!
        val wrapper = Thread.UncaughtExceptionHandler { thread, throwable ->
            ours.uncaughtException(thread, throwable)
        }
        Thread.setDefaultUncaughtExceptionHandler(wrapper)
        collector.stop()
        assertEquals(wrapper, Thread.getDefaultUncaughtExceptionHandler())
        previousCalled = false
        wrapper.uncaughtException(Thread.currentThread(), RuntimeException("wrapped"))
        assertTrue(previousCalled)
        Thread.setDefaultUncaughtExceptionHandler(previous)
    }

    @Test
    fun shortIntervalInvokesTickSafeViaScheduler() {
        val latch = java.util.concurrent.CountDownLatch(1)
        val collector = SystemMetricsCollector(
            observe = { _, _ -> latch.countDown() },
            intervalMs = 40L,
            sampler = { listOf("CpuUsage" to 1.0) },
        )
        collector.start()
        assertTrue(latch.await(2, java.util.concurrent.TimeUnit.SECONDS))
        collector.stop()
    }

    @Test
    fun defaultClockAndProcessorDefaultsDoNotThrow() {
        val observed = mutableListOf<Pair<String, Double>>()
        val collector = SystemMetricsCollector(
            observe = { metric, value -> observed += metric to value },
        )
        collector.start()
        collector.tick()
        collector.stop()
        assertTrue(observed.none { !it.second.isFinite() })
    }

    @Test
    fun observeSystemMetricRoutesExceptionCountToCounter() = runTest {
        val requests = mutableListOf<okhttp3.Request>()
        val reporter = TelemetryReporter(
            "metrics-key",
            scope = backgroundScope,
            now = { testScheduler.currentTime },
            transport = { requests += it; TelemetryResponse(202) },
        )
        observeSystemMetric(reporter, "ExceptionCount", 2.0)
        observeSystemMetric(reporter, "CpuUsage", 12.5)
        reporter.flushTelemetry()
        assertTrue(requests.isNotEmpty())
        reporter.dispose()
    }
}
