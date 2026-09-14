defmodule Toggly.NullParametersTest do
  use ExUnit.Case
  import Toggly.TestSigning, only: [signed: 2]

  @raw ~s([ {"featureKey":"null-on","filters":[{"name":"AlwaysOn","parameters":null}]},
  {"featureKey":"missing-on","filters":[{"name":"AlwaysOn"}]},
  {"featureKey":"mapped-on","filters":[{"name":"Percentage","parameters":{"Value":"100"}}]} ])

  test "signed null and missing parameters activate while preserving original bytes across cold restart" do
    {body, jwks} = signed(@raw, System.system_time(:second))
    path = temporary_path()

    {:ok, online} =
      Toggly.start_link(
        name: NullParametersOnline,
        app_key: "test",
        jwks: jwks,
        snapshot_path: path,
        refresh_interval: 0,
        flush_interval: 0,
        websocket: false,
        transport: fn _ -> {:ok, %{status: 200, body: body, headers: [{"etag", "accepted"}]}} end
      )

    try do
      assert :ok = Toggly.refresh(NullParametersOnline)
      assert Toggly.snapshot(NullParametersOnline).source == :remote
      assert Toggly.enabled?(NullParametersOnline, ["null-on", "missing-on", "mapped-on"])

      # Acceptance normalizes only the evaluation model, after signature checks.
      # Persist the original signed envelope, including its explicit JSON null.
      saved = File.read!(path)
      assert Jason.decode!(saved)["envelope"] == body
      assert Jason.decode!(saved)["envelope"] =~ ~s("parameters":null)
    after
      Toggly.stop(online)
    end

    expected_hash = :crypto.hash(:sha256, File.read!(path)) |> Base.encode16(case: :lower)

    # A fresh BEAM process has no prior ETS, key cache or evaluated definitions.
    # All SDK HTTP transport is denied; its only trust input is the saved record.
    script = """
    {:ok, _} = Application.ensure_all_started(:toggly)
    [path, expected_hash] = System.argv()
    {:ok, requests} = Agent.start_link(fn -> 0 end)

    deny = fn _ ->
      Agent.update(requests, &(&1 + 1))
      {:error, :offline}
    end

    {:ok, client} =
      Toggly.start_link(
        name: NullParametersCold,
        app_key: "test",
        snapshot_path: path,
        refresh_interval: 0,
        flush_interval: 0,
        websocket: false,
        transport: deny
      )

    try do
      %{source: :snapshot} = before = Toggly.snapshot(NullParametersCold)
      true = Toggly.enabled?(NullParametersCold, ["null-on", "missing-on", "mapped-on"])
      0 = Agent.get(requests, & &1)
      {:error, :offline} = Toggly.refresh(NullParametersCold)
      1 = Agent.get(requests, & &1)
      ^before = Toggly.snapshot(NullParametersCold)
      ^expected_hash = :crypto.hash(:sha256, File.read!(path)) |> Base.encode16(case: :lower)
      IO.puts("fresh BEAM verified unchanged signed bytes with denied transport")
    after
      Toggly.stop(client)
      Agent.stop(requests)
    end
    """

    paths = :code.get_path() |> Enum.flat_map(&["-pa", List.to_string(&1)])

    assert {output, 0} =
             System.cmd(
               System.find_executable("elixir"),
               paths ++ ["-e", script, path, expected_hash],
               stderr_to_stdout: true
             )

    assert output =~ "fresh BEAM verified unchanged signed bytes with denied transport"
  end

  test "signed array and scalar parameters retain accepted definitions, revision and persisted bytes" do
    now = System.system_time(:second)
    {good, good_keys} = signed(@raw, now)

    invalid =
      for parameters <- [[], [%{}], "invalid", 0, 1.5, true, false] do
        raw =
          Jason.encode!([
            %{
              "featureKey" => "null-on",
              "filters" => [%{"name" => "AlwaysOn", "parameters" => parameters}]
            }
          ])

        signed(raw, now)
      end

    keys = %{
      "keys" => good_keys["keys"] ++ Enum.flat_map(invalid, fn {_, jwks} -> jwks["keys"] end)
    }

    {:ok, response} = Agent.start_link(fn -> {good, "accepted"} end)
    path = temporary_path()

    {:ok, client} =
      Toggly.start_link(
        name: NullParametersRejected,
        app_key: "test",
        jwks: keys,
        snapshot_path: path,
        refresh_interval: 0,
        flush_interval: 0,
        websocket: false,
        transport: fn _ ->
          {body, revision} = Agent.get(response, & &1)
          {:ok, %{status: 200, body: body, headers: [{"etag", revision}]}}
        end
      )

    try do
      assert :ok = Toggly.refresh(NullParametersRejected)
      before = Toggly.snapshot(NullParametersRejected)
      saved = File.read!(path)

      for {body, _} <- invalid do
        Agent.update(response, fn _ -> {body, "rejected"} end)
        assert {:error, :invalid_definitions} = Toggly.refresh(NullParametersRejected)
        assert Toggly.snapshot(NullParametersRejected) == before
        assert File.read!(path) == saved
      end

      # A pre-verification rewrite of null to an empty map must not conceal tampering.
      Agent.update(response, fn _ ->
        {String.replace(good, ~s("parameters":null), ~s("parameters":{})), "tampered"}
      end)

      assert {:error, :invalid_signature} = Toggly.refresh(NullParametersRejected)
      assert Toggly.snapshot(NullParametersRejected) == before
      assert File.read!(path) == saved
    after
      Toggly.stop(client)
      Agent.stop(response)
    end
  end

  defp temporary_path do
    path =
      Path.join(System.tmp_dir!(), "null-parameters-#{System.unique_integer([:positive])}.json")

    on_exit(fn -> File.rm(path) end)
    path
  end
end
