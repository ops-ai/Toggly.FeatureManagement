//go:build windows

package systemmetrics

func readRusageCPU() (rusageCPU, bool) {
	return rusageCPU{}, false
}
