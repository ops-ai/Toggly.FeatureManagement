//go:build !windows

package systemmetrics

import (
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
