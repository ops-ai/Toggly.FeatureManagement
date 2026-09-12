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

    parent = self()

    {:ok, offline} =
      Toggly.start_link(
        name: SignedOffline,
        app_key: "test",
        transport: fn req ->
          send(parent, {:offline_request, req})
          {:error, :offline}
        end,
        websocket: false,
        snapshot_path: path,
        refresh_interval: 0
      )

    assert Toggly.enabled?(SignedOffline, "webcrypto")
    assert Toggly.snapshot(SignedOffline).source == :snapshot
    refute_receive {:offline_request, _}
    assert {:error, :offline} = Toggly.refresh(SignedOffline)
    assert_receive {:offline_request, _}
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
    File.write!(path, Toggly.Snapshot.encode(@fixture["body"], @fixture["jwks"], []))
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

  test "scope fingerprint does not duplicate backend app credentials in the file" do
    {path, _} = persisted_fixture()
    record = Jason.decode!(File.read!(path))
    assert is_binary(record["context"])
    refute Map.has_key?(record, "app_key")
    assert byte_size(record["context"]) == 64
  end

  test "cold restore rejects corrupt envelope, public keys, scope, format and resource limits" do
    {path, original} = persisted_fixture()

    for corrupt <- [
          fn record ->
            put_in(
              record["envelope"],
              String.replace(record["envelope"], "webcrypto", "tampered")
            )
          end,
          fn record -> put_in(record["jwks"]["keys"], []) end,
          fn record ->
            put_in(record["jwks"]["keys"], List.duplicate(hd(record["jwks"]["keys"]), 33))
          end,
          fn record ->
            put_in(record["jwks"]["keys"], List.duplicate(hd(record["jwks"]["keys"]), 2))
          end,
          fn record ->
            update_in(record["jwks"]["keys"], fn [key] -> [Map.put(key, "x", "invalid")] end)
          end,
          fn record ->
            update_in(record["jwks"]["keys"], fn [key] -> [Map.put(key, "exp", 1)] end)
          end,
          fn record -> put_in(record["context"], "invalid-scope") end,
          fn record -> put_in(record["version"], 2) end
        ] do
      File.write!(path, Jason.encode!(corrupt.(original)))
      assert_offline(path, false)
    end

    for invalid <- ["bad JSON", @fixture["body"], String.duplicate(" ", 5_242_881)] do
      File.write!(path, invalid)
      assert_offline(path, false)
    end
  end

  test "current configured keys, key pins, signature age and HTTPS origin remain authoritative" do
    {path, original} = persisted_fixture()
    assert_offline(path, true)
    assert_offline(path, false, jwks: %{"keys" => []})
    assert_offline(path, false, allowed_kids: ["different"])
    assert_offline(path, false, max_signature_age_seconds: 60)
    assert_offline(path, false, app_key: "other")
    assert_offline(path, false, environment: "Staging")
    assert_offline(path, false, signed: false)
    assert_offline(path, false, base_url: "https://other.example")
    assert_offline(path, true, allowed_kids: [hd(@fixture["jwks"]["keys"])["kid"]])

    # Explicit keys cannot be overridden by the stored keyset, even if that
    # keyset has been damaged. Pins refer to coordinate-derived key IDs.
    File.write!(path, Jason.encode!(put_in(original["jwks"], %{"keys" => []})))
    assert_offline(path, true, jwks: @fixture["jwks"])

    http_scope =
      Toggly.Snapshot.encode(@fixture["body"], @fixture["jwks"],
        app_key: "test",
        base_url: "http://example.test"
      )
      |> Jason.decode!()
      |> Map.fetch!("context")

    http = put_in(original["context"], http_scope)
    File.write!(path, Jason.encode!(http))
    assert_offline(path, false, base_url: "http://example.test")
  end

  test "signed invalid definition schema cannot be adopted from persistent storage" do
    {path, original} = persisted_fixture()

    for raw <- [
          ~s([{"featureKey":"bad","filters":false}]),
          ~s([{"featureKey":"bad","filters":[]},{"featureKey":"bad","filters":[]}])
        ] do
      {body, jwks} = Toggly.TestSigning.signed(raw, System.system_time(:second))
      File.write!(path, Jason.encode!(%{original | "envelope" => body, "jwks" => jwks}))
      assert_offline(path, false)
    end
  end

  test "socket invalidation refresh persists rotated public keys and updated signed bytes" do
    path = temporary_path()
    now = System.system_time(:second)

    {body, jwks} =
      Toggly.TestSigning.signed(
        ~s([{"featureKey":"updated","filters":[{"name":"AlwaysOn"}]}]),
        now
      )

    {:ok, response} = Agent.start_link(fn -> {@fixture["body"], @fixture["jwks"]} end)

    transport = fn req ->
      {envelope, keys} = Agent.get(response, & &1)
      reply = if String.ends_with?(req.url, "jwks"), do: Jason.encode!(keys), else: envelope
      {:ok, %{status: 200, body: reply, headers: []}}
    end

    {:ok, online} =
      Toggly.start_link(
        name: RotationOnline,
        app_key: "test",
        transport: transport,
        websocket: false,
        debounce: 0,
        refresh_interval: 0,
        snapshot_path: path
      )

    assert :ok = Toggly.refresh(RotationOnline)
    assert :ok = Toggly.subscribe(RotationOnline)
    Agent.update(response, fn _ -> {body, jwks} end)

    assert {:ok, _} =
             Toggly.WebSocket.handle_frame({:text, "signing-key-updated"}, %{
               client: RotationOnline
             })

    # The documented wire message is JSON; unrecognized plain strings do not refresh.
    assert {:ok, _} =
             Toggly.WebSocket.handle_frame({:text, ~s({"type":"signing-key-updated"})}, %{
               client: RotationOnline
             })

    assert_receive {:toggly_updated, RotationOnline, _}
    assert Toggly.enabled?(RotationOnline, "updated")
    Toggly.stop(online)

    {:ok, offline} =
      Toggly.start_link(
        name: RotationOffline,
        app_key: "test",
        snapshot_path: path,
        transport: fn _ -> {:error, :offline} end,
        websocket: false,
        refresh_interval: 0
      )

    assert Toggly.enabled?(RotationOffline, "updated")
    refute Toggly.enabled?(RotationOffline, "webcrypto")
    assert Toggly.snapshot(RotationOffline).source == :snapshot
    Toggly.stop(offline)
  end

  test "persistence failure preserves verified remote state and public keys omit private material" do
    path = temporary_path()
    File.write!(path, "blocks directory creation")

    private_keys =
      Map.update!(@fixture["jwks"], "keys", fn [key] -> [Map.put(key, "d", "never-persist")] end)

    {:ok, client} =
      Toggly.start_link(
        name: FailedStorage,
        app_key: "test",
        jwks: private_keys,
        snapshot_path: Path.join(path, "file.json"),
        refresh_interval: 0,
        websocket: false,
        transport: fn _ -> {:ok, %{status: 200, body: @fixture["body"], headers: []}} end
      )

    assert :ok = Toggly.refresh(FailedStorage)
    assert Toggly.enabled?(FailedStorage, "webcrypto")
    assert {:ok, public} = Toggly.Signature.public_jwks(private_keys)
    refute Map.has_key?(hd(public["keys"]), "d")
    Toggly.stop(client)
  end

  test "persisted keys normalize optional null fields and exclude private key parameters" do
    {path, _} = persisted_fixture()

    keys =
      Map.update!(@fixture["jwks"], "keys", fn [key] ->
        [Map.merge(key, %{"exp" => nil, "use" => nil, "d" => "private-value"})]
      end)

    {:ok, online} =
      Toggly.start_link(
        name: PublicOnly,
        app_key: "test",
        jwks: keys,
        snapshot_path: path,
        refresh_interval: 0,
        websocket: false,
        transport: fn _ -> {:ok, %{status: 200, body: @fixture["body"], headers: []}} end
      )

    assert :ok = Toggly.refresh(PublicOnly)
    Toggly.stop(online)
    refute File.read!(path) =~ "private-value"
    assert_offline(path, true)
  end

  defp persisted_fixture do
    path = temporary_path()

    transport = fn req ->
      body =
        if String.ends_with?(req.url, "jwks"),
          do: Jason.encode!(@fixture["jwks"]),
          else: @fixture["body"]

      {:ok, %{status: 200, body: body, headers: []}}
    end

    {:ok, online} =
      Toggly.start_link(
        name: FixtureOnline,
        app_key: "test",
        transport: transport,
        websocket: false,
        refresh_interval: 0,
        snapshot_path: path
      )

    assert :ok = Toggly.refresh(FixtureOnline)
    Toggly.stop(online)
    {path, Jason.decode!(File.read!(path))}
  end

  defp temporary_path do
    path = Path.join(System.tmp_dir!(), "signed-cold-#{System.unique_integer([:positive])}.json")
    on_exit(fn -> File.rm(path) end)
    path
  end

  defp assert_offline(path, expected, extra \\ []) do
    parent = self()

    options =
      Keyword.merge(
        [
          name: FreshOffline,
          app_key: "test",
          snapshot_path: path,
          refresh_interval: 0,
          websocket: false,
          defaults: %{"safe" => true},
          transport: fn req ->
            send(parent, {:unexpected_network, req})
            {:error, :offline}
          end
        ],
        extra
      )

    {:ok, offline} = Toggly.start_link(options)
    assert Toggly.enabled?(FreshOffline, "webcrypto") == expected
    assert Toggly.enabled?(FreshOffline, "safe")
    assert Toggly.snapshot(FreshOffline).source == if(expected, do: :snapshot, else: :defaults)
    refute_received {:unexpected_network, _}
    Toggly.stop(offline)
  end
end
