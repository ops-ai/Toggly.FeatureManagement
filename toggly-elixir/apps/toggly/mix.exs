defmodule Toggly.MixProject do
  use Mix.Project

  def project do
    [
      app: :toggly,
      version: "0.1.0",
      elixir: "~> 1.20",
      description: "Toggly feature flags for Elixir OTP applications",
      package: [
        licenses: ["MIT"],
        links: %{
          "GitHub" => "https://github.com/ops-ai/Toggly.FeatureManagement",
          "Documentation" => "https://docs.toggly.io/sdks/elixir"
        }
      ],
      test_coverage: [summary: [threshold: 91]],
      deps: [
        {:bandit, "~> 1.8", only: :test},
        {:websock_adapter, "~> 0.6", only: :test},
        {:jason, "~> 1.4"},
        {:req, "~> 0.7.4"},
        {:websockex, "~> 0.5.1"},
        {:telemetry, "~> 1.3"},
        {:ua_parser, "~> 1.10"}
      ]
    ] ++ shared_paths()
  end

  def application, do: [extra_applications: [:logger, :crypto, :public_key]]

  defp umbrella?,
    do:
      System.get_env("TOGGLY_HEX_BUILD") != "1" and
        File.exists?(Path.expand("../../.toggly-umbrella", __DIR__))

  defp shared_paths do
    if umbrella?(),
      do: [
        build_path: "../../_build",
        config_path: "../../config/config.exs",
        deps_path: "../../deps",
        lockfile: "../../mix.lock"
      ],
      else: []
  end
end
