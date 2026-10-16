//go:build windows

package systemmetrics

func readRusageCPU() (rusageCPU, bool) {
	return rusageCPU{}, false
}

func readRusageMaxRSS() (int64, bool) {
	return 0, false
}
