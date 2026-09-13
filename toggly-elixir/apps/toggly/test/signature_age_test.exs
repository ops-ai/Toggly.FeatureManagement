defmodule Toggly.SignatureAgeTest do
  use ExUnit.Case, async: true
  import Toggly.TestSigning, only: [signed: 2]
  @raw ~s([{"featureKey":"x","filters":[{"name":"AlwaysOn"}]}])

  test "optional envelope age accepts within and equal boundaries and rejects older" do
    for {age, expected} <- [{59, :ok}, {60, :ok}, {61, :error}] do
      {body, jwks} = signed(@raw, 1000 - age)

      assert elem(
               Toggly.Signature.verify(body, jwks, now: 1000, max_signature_age_seconds: 60),
               0
             ) == expected
    end
  end

  test "unset, nil, zero and negative age limits preserve default offline behavior" do
    {body, jwks} = signed(@raw, 100)
    assert {:ok, _, 100} = Toggly.Signature.verify(body, jwks, now: 1000)

    for max_age <- [nil, 0, -1] do
      assert {:ok, _, 100} =
               Toggly.Signature.verify(body, jwks, now: 1000, max_signature_age_seconds: max_age)
    end
  end

  test "future skew and rollback protections remain active alongside age limits" do
    for max_age <- [nil, 0, -1, 60] do
      {allowed, jwks} = signed(@raw, 1300)

      assert {:ok, _, 1300} =
               Toggly.Signature.verify(allowed, jwks,
                 now: 1000,
                 max_signature_age_seconds: max_age
               )

      {future, jwks} = signed(@raw, 1301)

      assert {:error, :invalid_signature} =
               Toggly.Signature.verify(future, jwks,
                 now: 1000,
                 max_signature_age_seconds: max_age
               )

      {old, jwks} = signed(@raw, 990)

      assert {:error, :invalid_signature} =
               Toggly.Signature.verify(old, jwks,
                 now: 1000,
                 minimum_timestamp: 991,
                 max_signature_age_seconds: max_age
               )
    end
  end

  test "invalid limit types fail closed rather than silently disabling freshness" do
    {body, jwks} = signed(@raw, 1000)

    for invalid <- ["60", 60.5, false, [], %{}] do
      assert {:error, :invalid_signature} =
               Toggly.Signature.verify(body, jwks, now: 1000, max_signature_age_seconds: invalid)
    end
  end
end
