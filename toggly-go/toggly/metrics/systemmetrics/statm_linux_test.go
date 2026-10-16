//go:build linux || android

package systemmetrics

import "testing"

func TestReadLinuxStatmRSSFromProc(t *testing.T) {
	rss, ok := readLinuxStatmRSS()
	if !ok || rss == 0 {
		t.Fatalf("readLinuxStatmRSS() = %d, %v; want non-zero RSS", rss, ok)
	}
}
