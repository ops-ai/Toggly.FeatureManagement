defmodule Toggly.WebSocketTest do
  use ExUnit.Case

  test "wire invalidation messages ignore ping, unchanged and unknown frames" do
    for text <- [
          "update",
          "flags-updated",
          ~s({"type":"sync"}),
          ~s({"type":"flags-updated"}),
          ~s({"type":"signing-key-updated"})
        ] do
      assert Toggly.WebSocket.invalidates?(text)
    end

    for text <- [
          "ping",
          "bad",
          ~s({"type":"ping"}),
          ~s({"type":"sync","unchanged":true}),
          ~s({"type":"unknown"})
        ] do
      refute Toggly.WebSocket.invalidates?(text)
    end
  end

  test "URL includes escaped environment and SDK identity" do
    assert Toggly.WebSocket.url(
             base_url: "https://definitions.toggly.io/",
             app_key: "a/b",
             environment: "A B"
           ) == "wss://definitions.toggly.io/a%2Fb/A%20B/ws?sdk=elixir&sdkVersion=0.1.0"
  end
end
