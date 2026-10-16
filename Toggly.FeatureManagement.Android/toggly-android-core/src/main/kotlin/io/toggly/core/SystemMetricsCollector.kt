package io.toggly.core

import android.system.Os
import android.system.OsConstants
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max
import kotlin.math.min

/**
 * Opt-in client metrics: [CpuUsage] and [ExceptionCount] every 10s via gauges.
 */
internal class SystemMetricsCollector(
    private val observe: (String, Double) -> Unit,
    private val intervalMs: Long = INTERVAL_MS,
    private val sampler: (() -> List<Pair<String, Double>>)? = null,
    private val clockTick: () -> Long = {
        runCatching { Os.sysconf(OsConstants._SC_CLK_TCK) }.getOrDefault(100L)
    },
    private val processorCount: () -> Int = {
        max(1, Runtime.getRuntime().availableProcessors())
    },
    private val procStatReader: () -> Long? = DEFAULT_PROC_STAT_READER,
) {
    private val pendingByMetric = ConcurrentHashMap<String, Int>()
    private val exceptionCount = AtomicInteger()
    private var previousHandler: Thread.UncaughtExceptionHandler? = null
    private var ourHandler: Thread.UncaughtExceptionHandler? = null
    private var scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "toggly-system-metrics").apply { isDaemon = true }
    }
    private var future: ScheduledFuture<*>? = null
    private var started = false
    private var lastCpu: CpuSnapshot? = null
    private val defaultSampler: () -> List<Pair<String, Double>> = {
        val out = mutableListOf<Pair<String, Double>>()
        sampleCpuPercent()?.let { out += "CpuUsage" to it }
        val pendingExceptions = pendingByMetric.getOrDefault("ExceptionCount", 0)
        if (pendingExceptions < MAX_PENDING) {
            val exceptions = exceptionCount.getAndSet(0)
            if (exceptions > 0) out += "ExceptionCount" to exceptions.toDouble()
        }
        out
    }

    fun start() {
        if (started) return
        started = true
        lastCpu = readProcCpuJiffies()?.let { CpuSnapshot(it, System.nanoTime()) }
        attachUncaughtHandler()
        future = scheduler.scheduleAtFixedRate(
            { tickSafe() },
            intervalMs,
            intervalMs,
            TimeUnit.MILLISECONDS,
        )
    }

    fun stop() {
        if (!started) return
        started = false
        future?.cancel(false)
        future = null
        detachUncaughtHandler()
        pendingByMetric.clear()
        lastCpu = null
        scheduler.shutdownNow()
        scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "toggly-system-metrics").apply { isDaemon = true }
        }
    }

    fun onFlushed() {
        pendingByMetric.clear()
    }

    fun tick() {
        if (!started) return
        val samples = sampler?.invoke() ?: defaultSampler()
        for ((metric, value) in samples) {
            if (!value.isFinite()) continue
            val pending = pendingByMetric.getOrDefault(metric, 0)
            if (pending >= MAX_PENDING) continue
            pendingByMetric[metric] = pending + 1
            observe(metric, value)
        }
    }

    private fun tickSafe() {
        runCatching { tick() }
    }

    private fun sampleCpuPercent(): Double? {
        val jiffies = readProcCpuJiffies() ?: return null
        val nowNs = System.nanoTime()
        val previous = lastCpu ?: run {
            lastCpu = CpuSnapshot(jiffies, nowNs)
            return null
        }
        lastCpu = CpuSnapshot(jiffies, nowNs)
        val wallNs = nowNs - previous.nanoTime
        if (wallNs <= 0) return null
        val deltaJiffies = jiffies - previous.jiffies
        if (deltaJiffies < 0) return null
        val tick = clockTick().coerceAtLeast(1L)
        val cpuNs = (deltaJiffies * 1_000_000_000L) / tick
        val cores = processorCount()
        val pct = (cpuNs * 100.0 / wallNs) / cores
        if (!pct.isFinite() || pct < 0) return null
        return min(100.0, pct)
    }

    private fun readProcCpuJiffies(): Long? = procStatReader()

    private fun attachUncaughtHandler() {
        runCatching {
            previousHandler = Thread.getDefaultUncaughtExceptionHandler()
            val handler = Thread.UncaughtExceptionHandler { thread, throwable ->
                exceptionCount.incrementAndGet()
                previousHandler?.uncaughtException(thread, throwable)
            }
            ourHandler = handler
            Thread.setDefaultUncaughtExceptionHandler(handler)
        }
    }

    private fun detachUncaughtHandler() {
        runCatching {
            if (Thread.getDefaultUncaughtExceptionHandler() === ourHandler) {
                Thread.setDefaultUncaughtExceptionHandler(previousHandler)
            }
        }
        ourHandler = null
        previousHandler = null
    }

    private data class CpuSnapshot(val jiffies: Long, val nanoTime: Long)

    companion object {
        const val INTERVAL_MS = 10_000L
        const val MAX_PENDING = 30

        private val DEFAULT_PROC_STAT_READER: () -> Long? = { readProcCpuJiffiesFromFile() }

        private fun readProcCpuJiffiesFromFile(): Long? {
            return runCatching {
                val stat = File("/proc/self/stat").readText()
                val afterPid = stat.indexOf(") ")
                if (afterPid < 0) return@runCatching null
                val fields = stat.substring(afterPid + 2).split(' ')
                if (fields.size < 15) return@runCatching null
                val utime = fields[11].toLongOrNull() ?: return@runCatching null
                val stime = fields[12].toLongOrNull() ?: return@runCatching null
                utime + stime
            }.getOrNull()
        }
    }
}
