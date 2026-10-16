//! Opt-in process metrics sampled every 10s when business metrics are enabled.

use super::metrics_batcher::MetricsFeatureOptions;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::watch;
use tokio::task::JoinHandle;

/// Default sampling interval for opt-in system metrics.
pub const SYSTEM_METRICS_INTERVAL: Duration = Duration::from_secs(10);

type ObserveFn = Arc<dyn Fn(&str, f64, Option<&MetricsFeatureOptions>) + Send + Sync>;
type SamplerFn = Arc<dyn Fn() -> Vec<(String, f64)> + Send + Sync>;

struct CpuSnapshot {
    user_micros: i64,
    system_micros: i64,
    at: Instant,
}

static PANIC_EXCEPTIONS: AtomicU64 = AtomicU64::new(0);

/// Periodic process sampler that posts gauges through an observe callback.
pub struct SystemMetricsCollector {
    observe: ObserveFn,
    custom_sampler: Option<SamplerFn>,
    cpu_state: Mutex<Option<CpuSnapshot>>,
    cancel_tx: watch::Sender<bool>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl SystemMetricsCollector {
    /// Start the background sampler. Pass `sampler` to inject values in tests.
    pub fn start(observe: ObserveFn, sampler: Option<SamplerFn>) -> Arc<Self> {
        install_panic_hook();

        let (cancel_tx, cancel_rx) = watch::channel(false);
        let collector = Arc::new(Self {
            observe,
            custom_sampler: sampler,
            cpu_state: Mutex::new(None),
            cancel_tx,
            task: Mutex::new(None),
        });

        let worker = collector.clone();
        let mut cancel_rx = cancel_rx;
        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(SYSTEM_METRICS_INTERVAL);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = ticker.tick() => worker.tick(),
                    _ = cancel_rx.changed() => {
                        if *cancel_rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });
        *collector.task.lock() = Some(handle);
        collector
    }

    /// Sample once and emit gauges (also invoked by the background timer).
    pub fn tick(&self) {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let samples = if let Some(sampler) = &self.custom_sampler {
                sampler()
            } else {
                self.build_sample()
            };
            for (metric, value) in samples {
                if value.is_finite() && value >= 0.0 {
                    (self.observe)(&metric, value, None);
                }
            }
            let exceptions = PANIC_EXCEPTIONS.swap(0, Ordering::Relaxed);
            if exceptions > 0 {
                (self.observe)("ExceptionCount", exceptions as f64, None);
            }
        }));
    }

    /// Cancel the background sampler task.
    pub fn stop(&self) {
        let _ = self.cancel_tx.send(true);
        if let Some(handle) = self.task.lock().take() {
            handle.abort();
        }
    }

    fn build_sample(&self) -> Vec<(String, f64)> {
        let mut out = Vec::new();
        if let Some(cpu) = self.sample_cpu() {
            out.push(("CpuUsage".into(), cpu));
        }
        if let Some(mem) = sample_memory_working_set() {
            out.push(("MemoryWorkingSet".into(), mem));
        }
        out
    }

    fn sample_cpu(&self) -> Option<f64> {
        let cur = read_process_cpu()?;
        let mut guard = self.cpu_state.lock();
        let prev = guard.replace(CpuSnapshot {
            user_micros: cur.user_micros,
            system_micros: cur.system_micros,
            at: cur.at,
        });
        let prev = prev?;
        let wall = cur.at.duration_since(prev.at);
        let wall_us = wall.as_micros().max(1) as f64;
        let cpu_us =
            (cur.user_micros - prev.user_micros) + (cur.system_micros - prev.system_micros);
        if cpu_us < 0 {
            return None;
        }
        let n_cpu = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .max(1) as f64;
        let pct = (cpu_us as f64 / wall_us / n_cpu) * 100.0;
        if !pct.is_finite() || pct < 0.0 {
            return None;
        }
        Some(pct.min(100.0))
    }
}

struct ProcessCpu {
    user_micros: i64,
    system_micros: i64,
    at: Instant,
}

fn read_process_cpu() -> Option<ProcessCpu> {
    if let Some(cpu) = read_linux_proc_stat_cpu() {
        return Some(cpu);
    }
    read_rusage_cpu()
}

fn read_linux_proc_stat_cpu() -> Option<ProcessCpu> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
    let after = stat.rsplit(')').next()?.trim();
    let mut fields = after.split_whitespace();
    let utime: i64 = fields.nth(11)?.parse().ok()?;
    let stime: i64 = fields.next()?.parse().ok()?;
    let hz = linux_clock_ticks_per_sec();
    Some(ProcessCpu {
        user_micros: utime * 1_000_000 / hz,
        system_micros: stime * 1_000_000 / hz,
        at: Instant::now(),
    })
}

fn linux_clock_ticks_per_sec() -> i64 {
    std::env::var("CLK_TCK")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(100)
}

#[cfg(unix)]
mod rusage_ffi {
    use super::{Instant, ProcessCpu};

    #[repr(C)]
    struct TimeVal {
        tv_sec: i64,
        tv_usec: i64,
    }

    /// Full `struct rusage` layout (macOS/Linux). Truncating this overflows the stack
    /// when getrusage writes the remaining fields.
    #[repr(C)]
    pub(super) struct Rusage {
        ru_utime: TimeVal,
        ru_stime: TimeVal,
        ru_maxrss: i64,
        ru_ixrss: i64,
        ru_idrss: i64,
        ru_isrss: i64,
        ru_minflt: i64,
        ru_majflt: i64,
        ru_nswap: i64,
        ru_inblock: i64,
        ru_oublock: i64,
        ru_msgsnd: i64,
        ru_msgrcv: i64,
        ru_nsignals: i64,
        ru_nvcsw: i64,
        ru_nivcsw: i64,
    }

    extern "C" {
        fn getrusage(who: i32, usage: *mut Rusage) -> i32;
    }

    const RUSAGE_SELF: i32 = 0;

    fn read_rusage() -> Option<Rusage> {
        let mut ru = unsafe { std::mem::zeroed::<Rusage>() };
        if unsafe { getrusage(RUSAGE_SELF, &mut ru) } != 0 {
            return None;
        }
        Some(ru)
    }

    pub(super) fn read_cpu() -> Option<ProcessCpu> {
        let ru = read_rusage()?;
        let user = ru.ru_utime.tv_sec * 1_000_000 + ru.ru_utime.tv_usec;
        let system = ru.ru_stime.tv_sec * 1_000_000 + ru.ru_stime.tv_usec;
        Some(ProcessCpu {
            user_micros: user,
            system_micros: system,
            at: Instant::now(),
        })
    }

}

fn read_rusage_cpu() -> Option<ProcessCpu> {
    #[cfg(unix)]
    {
        rusage_ffi::read_cpu()
    }
    #[cfg(not(unix))]
    {
        None
    }
}

fn sample_memory_working_set() -> Option<f64> {
    // Catalog MemoryWorkingSet is current RSS. Linux exposes VmRSS; rusage
    // MaxRSS is a peak high-water mark, so omit elsewhere.
    read_linux_vm_rss_bytes().map(|rss| rss as f64)
}

fn read_linux_vm_rss_bytes() -> Option<u64> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let raw = std::fs::read_to_string("/proc/self/status").ok()?;
    for line in raw.lines() {
        let Some(rest) = line.strip_prefix("VmRSS:") else {
            continue;
        };
        let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
        return kb.checked_mul(1024);
    }
    None
}

fn install_panic_hook() {
    static INSTALLED: std::sync::Once = std::sync::Once::new();
    INSTALLED.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            PANIC_EXCEPTIONS.fetch_add(1, Ordering::Relaxed);
            previous(info);
        }));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    #[test]
    fn tick_emits_injected_samples_and_exception_count() {
        let seen: Arc<StdMutex<Vec<(String, f64)>>> = Arc::new(StdMutex::new(Vec::new()));
        let seen2 = seen.clone();
        let observe: ObserveFn = Arc::new(move |metric, value, _| {
            seen2.lock().unwrap().push((metric.to_string(), value));
        });
        let sampler: SamplerFn = Arc::new(|| {
            vec![
                ("CpuUsage".into(), 3.0),
                ("MemoryWorkingSet".into(), 1024.0),
            ]
        });
        PANIC_EXCEPTIONS.store(2, Ordering::Relaxed);
        let collector = SystemMetricsCollector {
            observe,
            custom_sampler: Some(sampler),
            cpu_state: Mutex::new(None),
            cancel_tx: watch::channel(false).0,
            task: Mutex::new(None),
        };
        collector.tick();
        let rows = seen.lock().unwrap();
        assert!(rows.iter().any(|(m, v)| m == "CpuUsage" && *v == 3.0));
        assert!(rows
            .iter()
            .any(|(m, v)| m == "MemoryWorkingSet" && *v == 1024.0));
        assert!(rows.iter().any(|(m, v)| m == "ExceptionCount" && *v == 2.0));
    }
}
