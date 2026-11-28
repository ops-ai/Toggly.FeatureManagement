defmodule Toggly.FeatureValueCodec do
  @moduledoc """
  Soft-decodes a resolved feature's value by its declared catalog `"valueType"`
  (OPS-2102).

  Mirrors the wire contract used across Toggly SDKs: a feature definition map
  may carry a `"valueType"` of `"boolean" | "string" | "number" | "json" |
  "datetime"`. These helpers never raise solely for a shape mismatch and never
  return a wrong-typed value — they soft-null (`nil`) on a declared-type
  mismatch or a decode failure.

  Legacy catalogs without a declared `"valueType"` (a `nil`/empty `declared`
  argument) still attempt the decode so older flags keep working; the decode
  itself is still soft-null on failure.
  """

  @value_types ~w(boolean string number json datetime)

  @doc "Returns whether `value` is a recognized FeatureValueType string."
  @spec feature_value_type?(term()) :: boolean()
  def feature_value_type?(value), do: value in @value_types

  @doc """
  Returns whether a typed getter for `requested` may attempt a decode against
  `declared`.

  A missing/empty `declared` (legacy catalogs predating `"valueType"`) always
  allows the decode attempt; the decode itself still soft-nulls on failure.
  """
  @spec value_type_matches?(String.t() | nil, String.t()) :: boolean()
  def value_type_matches?(declared, requested)
  def value_type_matches?(nil, _requested), do: true
  def value_type_matches?("", _requested), do: true
  def value_type_matches?(declared, requested), do: declared == requested

  @doc "Soft-decodes `raw` as a string, or `nil` on mismatch/non-string input."
  @spec decode_string_value(term(), String.t() | nil) :: String.t() | nil
  def decode_string_value(raw, declared \\ nil) do
    if value_type_matches?(declared, "string") and is_binary(raw), do: raw
  end

  @doc """
  Soft-decodes `raw` as a finite number, or `nil` on mismatch/failure.
  Booleans are never treated as numbers.
  """
  @spec decode_number_value(term(), String.t() | nil) :: number() | nil
  def decode_number_value(raw, declared \\ nil) do
    if value_type_matches?(declared, "number"), do: decode_number(raw)
  end

  defp decode_number(raw) when is_boolean(raw), do: nil
  defp decode_number(raw) when is_number(raw), do: raw

  defp decode_number(raw) when is_binary(raw) do
    case String.trim(raw) do
      "" ->
        nil

      trimmed ->
        case Float.parse(trimmed) do
          {value, ""} -> value
          _ -> nil
        end
    end
  end

  defp decode_number(_raw), do: nil

  @doc """
  Soft-decodes `raw` as a JSON object/array value tree (map/list), or `nil`
  on mismatch/undecodable input.
  """
  @spec decode_json_value(term(), String.t() | nil) :: map() | list() | nil
  def decode_json_value(raw, declared \\ nil) do
    if value_type_matches?(declared, "json"), do: decode_json(raw)
  end

  defp decode_json(raw) when is_map(raw) or is_list(raw), do: raw

  defp decode_json(raw) when is_binary(raw) do
    case String.trim(raw) do
      "" ->
        nil

      trimmed ->
        case safe_json_decode(trimmed) do
          value when is_map(value) or is_list(value) -> value
          _ -> nil
        end
    end
  end

  defp decode_json(_raw), do: nil

  defp safe_json_decode(text) do
    Toggly.JSON.decode!(text)
  rescue
    _ -> nil
  end

  @doc """
  Soft-decodes `raw` as a `DateTime` parsed from an ISO-8601 string.

  Soft-nulls on a non-ISO-8601 string, non-string/`DateTime` input, or a
  declared-type mismatch.
  """
  @spec decode_datetime_value(term(), String.t() | nil) :: DateTime.t() | nil
  def decode_datetime_value(raw, declared \\ nil) do
    if value_type_matches?(declared, "datetime"), do: decode_datetime(raw)
  end

  defp decode_datetime(%DateTime{} = dt), do: dt

  defp decode_datetime(raw) when is_binary(raw) do
    case String.trim(raw) do
      "" ->
        nil

      trimmed ->
        case DateTime.from_iso8601(trimmed) do
          {:ok, dt, _offset} -> dt
          {:error, _reason} -> nil
        end
    end
  end

  defp decode_datetime(_raw), do: nil
end
