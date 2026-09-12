defmodule Toggly.Signature do
  @moduledoc "Verifies Toggly's ES256 signed definitions before they become active."
  @spec verify(binary(), map(), keyword()) :: {:ok, list(), integer()} | {:error, atom()}
  def verify(body, jwks, options \\ []) do
    max_age = validate_max_age!(Keyword.get(options, :max_signature_age_seconds))
    {:ok, jwks} = public_jwks(jwks)
    envelope = Toggly.JSON.decode!(body)
    %{"defs" => defs, "signature" => signature, "timestamp" => timestamp, "kid" => kid} = envelope
    true = is_list(defs) and is_integer(timestamp)
    now = Keyword.get(options, :now, System.system_time(:second))
    true = timestamp >= Keyword.get(options, :minimum_timestamp, 0) and timestamp <= now + 300
    true = is_nil(max_age) or max_age <= 0 or now - timestamp <= max_age
    allowed = Keyword.get(options, :allowed_kids, [])
    true = allowed == [] or kid in allowed
    key = Enum.find(jwks["keys"], &(&1["kid"] == kid))
    %{"alg" => "ES256", "kty" => "EC", "crv" => "P-256", "x" => x, "y" => y} = key
    true = is_nil(key["exp"]) or (is_integer(key["exp"]) and key["exp"] > now)
    true = is_nil(key["use"]) or key["use"] == "sig"
    {:ok, <<x::binary-size(32)>>} = Base.url_decode64(x, padding: false)
    {:ok, <<y::binary-size(32)>>} = Base.url_decode64(y, padding: false)
    true = kid == Base.encode16(:crypto.hash(:sha, x <> y)) <> "ES256"
    {:ok, sig} = Base.decode64(signature)

    sig =
      case sig do
        <<r::unsigned-256, s::unsigned-256>> ->
          :public_key.der_encode(:"ECDSA-Sig-Value", {:"ECDSA-Sig-Value", r, s})

        der ->
          der
      end

    data = Toggly.JSON.raw_field!(body, "defs") <> "|" <> to_string(timestamp)

    true =
      :crypto.verify(:ecdsa, :sha256, :crypto.hash(:sha256, data), sig, [
        <<4, x::binary, y::binary>>,
        :secp256r1
      ])

    {:ok, defs, timestamp}
  rescue
    _ -> {:error, :invalid_signature}
  end

  @doc false
  def public_jwks(%{"keys" => keys}) when is_list(keys) and length(keys) in 1..32 do
    public = Enum.map(keys, &public_key!/1)
    true = length(Enum.uniq_by(public, & &1["kid"])) == length(public)
    {:ok, %{"keys" => public}}
  rescue
    _ -> {:error, :invalid_jwks}
  end

  def public_jwks(_), do: {:error, :invalid_jwks}

  defp public_key!(
         %{"alg" => "ES256", "kty" => "EC", "crv" => "P-256", "kid" => kid, "x" => x, "y" => y} =
           key
       ) do
    {:ok, <<x_bytes::binary-size(32)>>} = Base.url_decode64(x, padding: false)
    {:ok, <<y_bytes::binary-size(32)>>} = Base.url_decode64(y, padding: false)
    true = kid == Base.encode16(:crypto.hash(:sha, x_bytes <> y_bytes)) <> "ES256"
    true = is_nil(key["exp"]) or is_integer(key["exp"])
    true = is_nil(key["use"]) or key["use"] == "sig"

    key
    |> Map.take(~w(alg kty crv kid x y exp use))
    |> Map.reject(fn {_, value} -> is_nil(value) end)
  end

  @doc false
  def validate_max_age!(value) when is_nil(value) or is_integer(value), do: value

  def validate_max_age!(_),
    do: raise(ArgumentError, "max_signature_age_seconds must be an integer or nil")
end
