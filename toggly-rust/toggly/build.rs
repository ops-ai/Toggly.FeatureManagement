fn main() -> Result<(), Box<dyn std::error::Error>> {
    // `tonic-build` is an optional build-dependency enabled only by the
    // `telemetry` feature — feature-off must not compile or link prost tooling.
    #[cfg(feature = "telemetry")]
    {
        tonic_build::configure()
            .build_server(false)
            .compile_protos(&["proto/usage.proto", "proto/metrics.proto"], &["proto"])?;
    }
    Ok(())
}
