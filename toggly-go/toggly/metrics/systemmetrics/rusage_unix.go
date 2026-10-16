//go:build !windows

package systemmetrics

import (
	"runtime"
	"syscall"
)

func readRusageCPU() (rusageCPU, bool) {
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		return rusageCPU{}, false
	}
	user := ru.Utime.Sec*1_000_000 + int64(ru.Utime.Usec)
	system := ru.Stime.Sec*1_000_000 + int64(ru.Stime.Usec)
	return rusageCPU{user: user, system: system}, true
}

func readRusageMaxRSS() (int64, bool) {
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		return 0, false
	}
	rss := int64(ru.Maxrss)
	if rss <= 0 {
		return 0, false
	}
	if runtime.GOOS == "linux" || runtime.GOOS == "android" {
		rss *= 1024
	}
	return rss, true
}
