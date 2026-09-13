defmodule Toggly.SignatureTest do
  use ExUnit.Case, async: true

  import Toggly.TestSigning, only: [signed: 0]

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
