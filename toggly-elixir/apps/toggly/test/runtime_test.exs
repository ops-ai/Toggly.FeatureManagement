defmodule Toggly.RuntimeTest do
  use ExUnit.Case, async: true

  test "accepts the current OTP release and rejects pre-OTP 27" do
    assert Toggly.Runtime.ensure_otp!() == :ok
    assert Toggly.Runtime.otp_release() >= 27

    assert_raise ArgumentError, ~r/OTP 27\+ \(found OTP 26\)/, fn ->
      Toggly.Runtime.ensure_otp!(26)
    end
  end
end
