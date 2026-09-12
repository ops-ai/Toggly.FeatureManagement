defmodule TogglyPhoenix.MixProject do
  use Mix.Project

  def project do
    [
      app: :toggly_phoenix,
      version: "0.1.0",
      elixir: "~> 1.20",
      description: "Toggly feature flags for toggly phoenix",
      package: [
        licenses: ["MIT"],
        links: %{
          "GitHub" => "https://github.com/ops-ai/Toggly.FeatureManagement",
          "Documentation" => "https://docs.toggly.io/sdks/elixir"
        }
      ],
      test_coverage: [summary: [threshold: 91]],
      deps: [local_dependency(:toggly), {:plug, "~> 1.18"}]
    ] ++ shared_paths()
  end

  def application, do: [extra_applications: [:logger, :crypto, :public_key]]

  defp local_dependency(app),
    do: if(umbrella?(), do: {app, "~> 0.1.0", in_umbrella: true}, else: {app, "~> 0.1.0"})

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
