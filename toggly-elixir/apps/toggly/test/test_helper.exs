ExUnit.start()

defmodule Toggly.TestSigning do
  def signed(
        raw \\ "[ {\"featureKey\":\"x\",\"filters\":[{\"name\":\"AlwaysOn\"}]} ]",
        timestamp \\ 100
      ) do
    {public, private} = :crypto.generate_key(:ecdh, :secp256r1)
    <<4, x::binary-size(32), y::binary-size(32)>> = public
    kid = Base.encode16(:crypto.hash(:sha, x <> y)) <> "ES256"

    jwk = %{
      "kid" => kid,
      "alg" => "ES256",
      "kty" => "EC",
      "crv" => "P-256",
      "x" => Base.url_encode64(x, padding: false),
      "y" => Base.url_encode64(y, padding: false)
    }

    sig =
      :crypto.sign(:ecdsa, :sha256, :crypto.hash(:sha256, raw <> "|" <> to_string(timestamp)), [
        private,
        :secp256r1
      ])

    {:"ECDSA-Sig-Value", r, s} = :public_key.der_decode(:"ECDSA-Sig-Value", sig)

    envelope = %{
      "signature" => Base.encode64(<<r::unsigned-256, s::unsigned-256>>),
      "timestamp" => timestamp,
      "kid" => kid
    }

    body = String.trim_trailing(Jason.encode!(envelope), "}") <> ",\"defs\":" <> raw <> "}"
    {body, %{"keys" => [jwk]}}
  end
end
