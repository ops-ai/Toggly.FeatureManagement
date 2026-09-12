defmodule Toggly.SignatureTest do
  use ExUnit.Case, async: true

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

  test "verifies exact signed bytes in arbitrary envelope order and P1363 signatures" do
    {body, keys} = signed()
    assert {:ok, [%{"featureKey" => "x"}], 100} = Toggly.Signature.verify(body, keys, now: 100)

    assert {:error, _} =
             Toggly.Signature.verify(String.replace(body, "AlwaysOn", "AlwaysOff"), keys,
               now: 100
             )

    assert {:error, _} = Toggly.Signature.verify(body, keys, now: 100, minimum_timestamp: 101)
    assert {:error, _} = Toggly.Signature.verify(body, keys, now: 100, allowed_kids: ["other"])
  end

  test "rejects untrusted shape, kid, curve, expired keys, malformed bytes and future timestamps" do
    {body, %{"keys" => [key]} = keys} = signed()

    for edit <- [
          %{"kid" => "wrong"},
          %{"alg" => "HS256"},
          %{"kty" => "RSA"},
          %{"crv" => "P-384"},
          %{"x" => "bad"},
          %{"exp" => 99}
        ] do
      assert {:error, _} =
               Toggly.Signature.verify(body, %{"keys" => [Map.merge(key, edit)]}, now: 100)
    end

    for bad <- [
          "bad",
          "[]",
          String.replace(body, "\"timestamp\":100", "\"timestamp\":100,\"timestamp\":101"),
          String.replace(body, "\"timestamp\":100", "\"timestamp\":99999999")
        ] do
      assert {:error, _} = Toggly.Signature.verify(bad, keys, now: 100)
    end

    assert {:error, _} = Toggly.Signature.verify(body, %{"keys" => []})
  end
end
