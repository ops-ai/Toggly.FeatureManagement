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

  test "configured age rejects a stale remote response without replacing defaults" do
    transport = fn _ ->
      {:ok, %{status: 200, body: @fixture["body"], headers: [{"etag", "stale"}]}}
    end

    start_supervised!(
      {Toggly,
       name: AgeColdStart,
       app_key: "test",
       jwks: @fixture["jwks"],
       transport: transport,
       defaults: %{"safe" => true},
       max_signature_age_seconds: 60,
       refresh_interval: 0,
       websocket: false}
    )

    assert {:error, :invalid_signature} = Toggly.refresh(AgeColdStart)

    assert %{source: :defaults, revision: nil, flags: %{"safe" => true}} =
             Toggly.snapshot(AgeColdStart)

    refute Toggly.enabled?(AgeColdStart, "webcrypto")
  end

  test "age rejection preserves a verified last-good snapshot and ETag, including forced refresh" do
    now = System.system_time(:second)

    {body, jwks} =
      Toggly.TestSigning.signed(~s([{"featureKey":"fresh","filters":[{"name":"AlwaysOn"}]}]), now)

    {:ok, revision} = Agent.start_link(fn -> "good" end)
    parent = self()

    transport = fn req ->
      send(parent, {:age_request, req.headers})
      {:ok, %{status: 200, body: body, headers: [{"etag", Agent.get(revision, & &1)}]}}
    end

    start_supervised!(
      {Toggly,
       name: AgeLastGood,
       app_key: "test",
       jwks: jwks,
       transport: transport,
       max_signature_age_seconds: 1,
       refresh_interval: 0,
       websocket: false}
    )

    assert :ok = Toggly.refresh(AgeLastGood)
    assert_receive {:age_request, _}
    before = Toggly.snapshot(AgeLastGood)
    # Let a genuinely verified envelope expire without changing the client state
    # or signed bytes. Equal timestamp still passes rollback, isolating freshness.
    Process.sleep(2000)
    Agent.update(revision, fn _ -> "rejected" end)
    assert {:error, :invalid_signature} = Toggly.refresh(AgeLastGood)
    assert_receive {:age_request, headers}
    assert {"if-none-match", "good"} in headers
    assert Toggly.snapshot(AgeLastGood) == before
    send(AgeLastGood, :apply_invalidation)
    assert_receive {:age_request, forced_headers}
    refute List.keymember?(forced_headers, "if-none-match", 0)
    # A call synchronizes after the forced refresh before reading the ETS view.
    assert :ok = Toggly.subscribe(AgeLastGood)
    assert Toggly.snapshot(AgeLastGood) == before
  end

  test "trusted signed snapshots honor enabled, disabled and unset age limits on cold start" do
    path = Path.join(System.tmp_dir!(), "age-snapshot-#{System.unique_integer([:positive])}.json")
    File.write!(path, @fixture["body"])
    on_exit(fn -> File.rm(path) end)

    for {name, max_age, expected} <- [
          {AgeSnapshotEnabled, 60, false},
          {AgeSnapshotNil, nil, true},
          {AgeSnapshotZero, 0, true},
          {AgeSnapshotNegative, -1, true}
        ] do
      start_supervised!(
        {Toggly,
         name: name,
         jwks: @fixture["jwks"],
         snapshot_path: path,
         defaults: %{"safe" => true},
         max_signature_age_seconds: max_age,
         refresh_interval: 0}
      )

      assert Toggly.enabled?(name, "webcrypto") == expected
      assert Toggly.enabled?(name, "safe")
      assert Toggly.snapshot(name).source == if(expected, do: :snapshot, else: :defaults)
    end
  end

  test "invalid client age settings fail startup validation" do
    for invalid <- ["60", 1.5, true] do
      assert {:error, reason} =
               start_supervised(
                 {Toggly,
                  name: InvalidAgeClient, max_signature_age_seconds: invalid, refresh_interval: 0}
               )

      assert inspect(reason) =~ "max_signature_age_seconds"
    end
  end
end
