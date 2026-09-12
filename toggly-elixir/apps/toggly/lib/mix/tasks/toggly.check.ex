defmodule Mix.Tasks.Toggly.Check do
  @moduledoc "Validate a local definitions JSON file. Signed files require --jwks PATH to a trusted JWKS."
  @shortdoc "Validate local Toggly definitions without management credentials"
  use Mix.Task
  @impl true
  def run(args) do
    {opts, paths, invalid} = OptionParser.parse(args, strict: [jwks: :string])

    if length(paths) != 1 or invalid != [],
      do: Mix.raise("Usage: mix toggly.check definitions.json [--jwks trusted-jwks.json]")

    body = File.read!(hd(paths))

    result =
      if opts[:jwks] do
        Toggly.Signature.verify(body, Toggly.JSON.decode!(File.read!(opts[:jwks])))
      else
        case Toggly.JSON.decode!(body) do
          definitions when is_list(definitions) -> {:ok, definitions, 0}
          _ -> {:error, :expected_unsigned_list_or_jwks}
        end
      end

    case result do
      {:ok, definitions, _} -> Mix.shell().info("Verified #{length(definitions)} definitions")
      {:error, reason} -> Mix.raise("Definitions rejected: #{reason}")
    end
  end
end
