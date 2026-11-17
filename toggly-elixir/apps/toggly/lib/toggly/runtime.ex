defmodule Toggly.Runtime do
  @moduledoc false

  # Elixir ~> 1.18 can pair with OTP 25/26, but signed definitions, snapshots and
  # usage encoding require OTP's :json module (OTP 27+). Fail clearly instead of
  # UndefinedFunctionError deep in decode/encode paths.
  @min_otp 27

  @doc false
  def ensure_otp!(otp \\ otp_release()) when is_integer(otp) do
    if otp < @min_otp do
      raise ArgumentError,
            "toggly requires Erlang/OTP #{@min_otp}+ (found OTP #{otp}); " <>
              "the OTP :json module is required for signed definitions and snapshots"
    end

    :ok
  end

  @doc false
  def otp_release do
    :erlang.system_info(:otp_release) |> List.to_integer()
  end
end
