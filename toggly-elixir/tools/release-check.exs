[package] = System.argv()
if package not in ~w(toggly toggly_phoenix toggly_live_view), do: raise("Unknown package")

version =
  Mix.Project.in_project(String.to_existing_atom(package), "apps/#{package}", fn _ ->
    Mix.Project.config()[:version]
  end)

Application.ensure_all_started(:req)
response = Req.get!("https://hex.pm/api/packages/#{package}", retry: false)

action =
  case response do
    %{status: 404} ->
      "publish"

    %{status: 200, body: body} ->
      latest = body["latest_stable_version"] || body["latest_version"]

      case Version.compare(version, latest) do
        :gt -> "publish"
        :eq -> "skip"
        :lt -> raise("Manifest version is behind Hex; bump manifest and changelog in a PR")
      end

    %{status: status} ->
      raise("Hex registry lookup failed with HTTP #{status}")
  end

IO.puts("#{package} #{version}: #{action}")

if output = System.get_env("GITHUB_OUTPUT"),
  do: File.write!(output, "action=#{action}\n", [:append])
