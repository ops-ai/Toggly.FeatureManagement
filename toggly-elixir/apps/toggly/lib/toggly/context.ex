defmodule Toggly.Context do
  @moduledoc "Explicit per-evaluation context. All map keys use the backend's string names."
  @type t :: %{optional(String.t()) => term()}
  @spec from_headers(map() | list(), t()) :: t()
  def from_headers(headers, context \\ %{}) do
    headers = Map.new(headers, fn {key, value} -> {String.downcase(key), value} end)
    request = Map.get(context, "request", %{})

    request =
      Enum.reduce(
        [
          {"user-agent", "userAgent"},
          {"accept-language", "acceptLanguage"},
          {"cf-ipcountry", "country"}
        ],
        request,
        fn {header, field}, acc ->
          case Map.fetch(headers, header) do
            {:ok, value} -> Map.put_new(acc, field, value)
            :error -> acc
          end
        end
      )

    Map.put(context, "request", request)
  end
end
