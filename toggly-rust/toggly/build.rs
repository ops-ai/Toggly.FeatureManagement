fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Only codegen when the optional `telemetry` Cargo feature is enabled so
    // core builds stay free of tonic/prost.
    if std::env::var_os("CARGO_FEATURE_TELEMETRY").is_some() {
        tonic_build::configure()
            .build_server(false)
            .compile_protos(&["proto/usage.proto", "proto/metrics.proto"], &["proto"])?;
    }
    Ok(())
}
