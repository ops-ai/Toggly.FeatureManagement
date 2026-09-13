defmodule Toggly.Transport do
  @moduledoc false
  def request(request) do
    opts = [
      method: request.method,
      url: request.url,
      headers: request.headers,
      retry: false,
      receive_timeout: request.timeout,
      connect_options: [timeout: request.timeout],
      decode_body: false,
      redirect: false
    ]

    opts = if Map.has_key?(request, :body), do: Keyword.put(opts, :body, request.body), else: opts

    case Req.request(opts) do
      {:ok, response} ->
        {:ok,
         %{
           status: response.status,
           body: response.body,
           headers: for({k, vs} <- response.headers, v <- vs, do: {k, v})
         }}

      {:error, _} ->
        {:error, :network}
    end
  end

  def url(base, path), do: String.trim_trailing(base, "/") <> "/" <> path
  def segment(value), do: URI.encode(value, &URI.char_unreserved?/1)
end
