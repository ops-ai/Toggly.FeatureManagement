defmodule Toggly.Segments do
  @moduledoc """
  Backend-key client for targeting-list membership on `https://app.toggly.io`.
  """

  @default_base "https://app.toggly.io"

  def list_segments(opts), do: request(:get, "/api/v2/segments", nil, opts)

  def add_segment_members(segment, identifiers, opts),
    do: request(:post, items_path(segment), %{identifiers: identifiers}, opts)

  def remove_segment_members(segment, identifiers, opts),
    do: request(:delete, items_path(segment), %{identifiers: identifiers}, opts)

  def replace_segment_members(segment, identifiers, opts),
    do: request(:put, items_path(segment), %{identifiers: identifiers}, opts)

  defp items_path(segment),
    do: "/api/v2/segments/" <> URI.encode(segment, &URI.char_unreserved?/1) <> "/items"

  defp request(method, path, body, opts) do
    app_key = Keyword.fetch!(opts, :app_key)
    base = opts |> Keyword.get(:app_base_url, @default_base) |> String.trim_trailing("/")
    payload = if body, do: Jason.encode!(body), else: nil

    headers = [
      {"authorization", app_key},
      {"accept", "application/json"},
      {"content-type", "application/json"}
    ]

    request = %{method: method, url: base <> path, headers: headers, timeout: 30_000}
    request = if payload, do: Map.put(request, :body, payload), else: request

    case Toggly.Transport.request(request) do
      {:ok, %{status: status, body: response_body}} when status >= 200 and status < 300 ->
        {:ok, Jason.decode!(response_body)}

      {:ok, %{status: status}} ->
        {:error, {:http, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end
end
