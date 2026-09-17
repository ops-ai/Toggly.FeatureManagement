fn main() -> Result<(), Box<dyn std::error::Error>> {
    // `tonic-build` is an optional build-dependency enabled only by the
    // `telemetry` feature — feature-off must not compile or link prost tooling.
    #[cfg(feature = "telemetry")]
    {
        let mut config = tonic_build::Config::new();
        config.protoc_executable(protoc_bin_vendored::protoc_bin_path()?);
        tonic_build::configure()
            .build_server(false)
            // `tonic::Status` is 176 bytes, so every generated client RPC's
            // `Result<_, Status>` trips `clippy::result_large_err`. That size
            // is tonic's to fix, not ours (see hyperium/tonic#2253), and this
            // codegen runs on every build, so scope the allow to the
            // generated client modules only rather than disabling the lint
            // crate-wide. tonic-build only accepts outer attributes here
            // (it parses them via `syn::DeriveInput`, which rejects `#![...]`),
            // and the generated `mod` already carries its own inner
            // `#![allow(...)]` block, so also allow `mixed_attributes_style`
            // to avoid a clippy conflict between the two attribute styles on
            // the same generated item.
            .client_mod_attribute(
                "Usage",
                "#[allow(clippy::result_large_err, clippy::mixed_attributes_style)]",
            )
            .client_mod_attribute(
                "Metrics",
                "#[allow(clippy::result_large_err, clippy::mixed_attributes_style)]",
            )
            .compile_protos_with_config(
                config,
                &["proto/usage.proto", "proto/metrics.proto"],
                &["proto"],
            )?;
    }
    Ok(())
}
