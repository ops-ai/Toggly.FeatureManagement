defmodule Toggly.Snapshot do
  @moduledoc false
  def read(nil), do: {:error, :disabled}

  # Limit allocation before decoding an application-owned file.
  @max_bytes 5_242_880
  def read(path) do
    case File.open(path, [:read, :binary]) do
      {:ok, file} ->
        try do
          case IO.binread(file, @max_bytes + 1) do
            body when is_binary(body) and byte_size(body) <= @max_bytes -> {:ok, body}
            _ -> {:error, :invalid_snapshot}
          end
        after
          File.close(file)
        end

      error ->
        error
    end
  end

  def encode(body, jwks, opts) do
    IO.iodata_to_binary(
      :json.encode(%{
        "version" => 1,
        "context" => context(opts),
        "envelope" => body,
        "jwks" => jwks || :null
      })
    )
  end

  def decode(body, opts) do
    case Toggly.JSON.decode!(body) do
      %{"version" => 1, "context" => scope, "envelope" => envelope, "jwks" => stored_keys}
      when is_binary(envelope) ->
        true = scope == context(opts)

        keys =
          cond do
            not Keyword.get(opts, :signed, true) -> nil
            not is_nil(opts[:jwks]) -> opts[:jwks]
            trusted_origin?(opts) -> stored_keys
            true -> nil
          end

        {:ok, envelope, keys}

      definitions when is_list(definitions) ->
        # Explicit unsigned local fixtures remain supported. Unscoped legacy
        # signed envelopes cannot establish which application produced them.
        false = Keyword.get(opts, :signed, true)
        {:ok, body, nil}

      _ ->
        {:error, :invalid_snapshot}
    end
  rescue
    _ -> {:error, :invalid_snapshot}
  end

  def trusted_origin?(opts) do
    case URI.parse(Keyword.get(opts, :base_url, "https://definitions.toggly.io")) do
      %URI{scheme: "https", host: host, userinfo: nil} when is_binary(host) and host != "" -> true
      _ -> false
    end
  end

  defp context(opts) do
    %{
      "base_url" =>
        String.trim_trailing(Keyword.get(opts, :base_url, "https://definitions.toggly.io"), "/"),
      "app_key" => opts[:app_key] || "",
      "environment" => Keyword.get(opts, :environment, "Production"),
      "signed" => Keyword.get(opts, :signed, true)
    }
  end

  def write(nil, _), do: :ok

  def write(_, body) when byte_size(body) > @max_bytes, do: {:error, :snapshot_too_large}

  def write(path, body) do
    temporary = path <> ".#{System.unique_integer([:positive])}.tmp"

    with :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.write(temporary, body, [:exclusive]),
         :ok <- File.chmod(temporary, 0o600),
         :ok <- File.rename(temporary, path) do
      :ok
    else
      error ->
        File.rm(temporary)
        error
    end
  end
end
