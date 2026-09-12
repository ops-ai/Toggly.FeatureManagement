defmodule Toggly.SignedClientTest do
  use ExUnit.Case
  import ExUnit.CaptureIO
  @fixture Jason.decode!(File.read!(Path.join(__DIR__, "fixtures/webcrypto.json")))
  test "accepts independent WebCrypto signature; fetched JWKS and trusted offline snapshot" do
    body = @fixture["body"]
    jwks = @fixture["jwks"]

    assert {:ok, [%{"featureKey" => "webcrypto"}], 1_700_000_000} =
             Toggly.Signature.verify(body, jwks)

    path = Path.join(System.tmp_dir!(), "signed-#{System.unique_integer([:positive])}.json")
    on_exit(fn -> File.rm(path) end)

    transport = fn req ->
      reply = if String.ends_with?(req.url, "jwks"), do: Jason.encode!(jwks), else: body
      {:ok, %{status: 200, body: reply, headers: []}}
    end

    sup =
      start_supervised!(
        {Toggly,
         name: SignedFlags,
         app_key: "test",
         transport: transport,
         websocket: false,
         refresh_interval: 0,
         snapshot_path: path}
      )

    assert :ok = Toggly.refresh(SignedFlags)
    assert Toggly.enabled?(SignedFlags, "webcrypto")
    Toggly.stop(sup)

    {:ok, offline} =
      Toggly.start_link(name: SignedOffline, jwks: jwks, snapshot_path: path, refresh_interval: 0)

    assert Toggly.enabled?(SignedOffline, "webcrypto")
    Toggly.stop(offline)

    {:ok, untrusted} =
      Toggly.start_link(name: SignedUntrusted, snapshot_path: path, refresh_interval: 0)

    refute Toggly.enabled?(SignedUntrusted, "webcrypto")
    Toggly.stop(untrusted)
  end

  test "JWKS errors, malformed definitions and transport exceptions retain defaults" do
    for {name, transport, expected} <- [
          {BadKeys,
           fn req ->
             {:ok,
              %{
                status: 200,
                body: if(String.ends_with?(req.url, "jwks"), do: "bad", else: @fixture["body"]),
                headers: []
              }}
           end, :invalid_jwks},
          {UnavailableKeys,
           fn req ->
             if String.ends_with?(req.url, "jwks"),
               do: {:error, :network},
               else: {:ok, %{status: 200, body: @fixture["body"], headers: []}}
           end, :jwks_unavailable},
          {BrokenTransport, fn _ -> raise "network adapter failure" end, :transport}
        ] do
      {:ok, sup} =
        Toggly.start_link(
          name: name,
          app_key: "test",
          transport: transport,
          defaults: %{"safe" => true},
          refresh_interval: 0,
          websocket: false
        )

      assert {:error, ^expected} = Toggly.refresh(name)
      assert Toggly.enabled?(name, "safe")
      Toggly.stop(sup)
    end
  end

  test "development task validates signed fixtures without management credentials" do
    path = Path.join(System.tmp_dir!(), "check-#{System.unique_integer([:positive])}")
    File.write!(path, @fixture["body"])
    File.write!(path <> ".jwks", Jason.encode!(@fixture["jwks"]))

    on_exit(fn ->
      File.rm(path)
      File.rm(path <> ".jwks")
    end)

    assert capture_io(fn -> Mix.Tasks.Toggly.Check.run([path, "--jwks", path <> ".jwks"]) end) =~
             "Verified 1 definitions"

    assert_raise Mix.Error, fn -> Mix.Tasks.Toggly.Check.run([]) end
    assert_raise Mix.Error, fn -> Mix.Tasks.Toggly.Check.run([path]) end
  end
end
