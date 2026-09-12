defmodule Toggly.Signature do
  @moduledoc "Verifies Toggly's ES256 signed definitions before they become active."
  @spec verify(binary(), map(), keyword()) :: {:ok, list(), integer()} | {:error, atom()}
  def verify(body, jwks, options \\ []) do
    envelope = Toggly.JSON.decode!(body)
    %{"defs" => defs, "signature" => signature, "timestamp" => timestamp, "kid" => kid} = envelope
    true = is_list(defs) and is_integer(timestamp)
    now = Keyword.get(options, :now, System.system_time(:second))
    true = timestamp >= Keyword.get(options, :minimum_timestamp, 0) and timestamp <= now + 300
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
end
