defmodule Toggly.JSON do
  @moduledoc false
  # OTP's parser validates JSON and supplies byte boundaries; signatures never
  # depend on re-encoding maps or normalizing whitespace/number representations.
  def decode!(body) do
    {value, _, rest} = :json.decode(body, nil, %{null: nil, object_push: &push_unique/3})
    if String.trim(rest) != "", do: raise(ArgumentError, "trailing JSON")
    value
  end

  defp push_unique(key, value, acc) do
    if List.keymember?(acc, key, 0), do: raise(ArgumentError, "duplicate JSON key")
    [{key, value} | acc]
  end

  def raw_field!(body, wanted) do
    <<"{", rest::binary>> = String.trim_leading(body)
    field(rest, wanted)
  end

  defp field(body, wanted) do
    {key, _, rest} = :json.decode(String.trim_leading(body), nil, %{})
    <<":", value::binary>> = String.trim_leading(rest)
    value = String.trim_leading(value)
    {_, _, tail} = :json.decode(value, nil, %{})

    if key == wanted do
      binary_part(value, 0, byte_size(value) - byte_size(tail)) |> String.trim_trailing()
    else
      <<",", next::binary>> = String.trim_leading(tail)
      field(next, wanted)
    end
  end
end
