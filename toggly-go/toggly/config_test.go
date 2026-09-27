package toggly

import "testing"

func TestConfigApplyDefaultsNormalizesEachEndpointOnce(t *testing.T) {
	cfg := Config{BaseURL: "https://app.example", MetricsURL: "https://metrics.example/", DefinitionsURL: "https://defs.example"}
	cfg.applyDefaults()
	if cfg.BaseURL != "https://app.example/" || cfg.MetricsURL != "https://metrics.example/" || cfg.DefinitionsURL != "https://defs.example/" {
		t.Fatalf("normalized endpoints = %q, %q, %q", cfg.BaseURL, cfg.MetricsURL, cfg.DefinitionsURL)
	}
	cfg.applyDefaults()
	if cfg.BaseURL != "https://app.example/" || cfg.MetricsURL != "https://metrics.example/" || cfg.DefinitionsURL != "https://defs.example/" {
		t.Fatal("applying defaults a second time changed endpoints")
	}
}
