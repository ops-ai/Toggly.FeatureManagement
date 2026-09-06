fn main() -> Result<(), Box<dyn std::error::Error>> {
    // `tonic-build` is an optional build-dependency enabled only by the
    // `telemetry` feature — feature-off must not compile or link prost tooling.
    #[cfg(feature = "telemetry")]
    {
        let mut config = tonic_build::Config::new();
        config.protoc_executable(protoc_bin_vendored::protoc_bin_path()?);
        tonic_build::configure()
            .build_server(false)
            .compile_protos_with_config(
                config,
                &["proto/usage.proto", "proto/metrics.proto"],
                &["proto"],
            )?;
    }
    Ok(())
}
