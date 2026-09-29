defmodule Toggly.SonarCoverage do
  @moduledoc false

  def run(root \\ File.cwd!()) do
    for package <- ~w(toggly toggly_phoenix toggly_live_view) do
      export_package(root, package)
    end
  end

  def export_package(root, package) do
    root = Path.expand(root)
    package_root = Path.join([root, "apps", package])
    export = Path.join(package_root, "cover/sonar.coverdata")
    beams = Path.wildcard(Path.join([root, "_build/test/lib", package, "ebin/*.beam"]))
    if beams == [], do: raise("Missing compiled BEAM files for #{package}")
    unless File.regular?(export), do: raise("Missing coverage export for #{package}")

    sources =
      Map.new(beams, fn beam ->
        {:ok, {module, [compile_info: info]}} =
          :beam_lib.chunks(String.to_charlist(beam), [:compile_info])

        source = info |> Keyword.fetch!(:source) |> List.to_string()
        {module, source_path!(source, root, package)}
      end)

    :cover.stop()
    {:ok, _} = :cover.start()

    try do
      :ok = :cover.import(String.to_charlist(export))
      modules = :cover.imported_modules()

      if MapSet.new(modules) != MapSet.new(Map.keys(sources)) do
        raise "Coverage export does not contain every compiled module for #{package}"
      end

      entries =
        Enum.flat_map(modules, fn module ->
          source = Map.fetch!(sources, module)
          {:ok, lines} = :cover.analyse(module, :coverage, :line)
          Enum.map(lines, fn {{^module, line}, coverage} -> {source, line, coverage} end)
        end)

      output = Path.join(package_root, "cover/sonar-coverage.xml")
      File.write!(output, to_xml(entries))
      IO.puts("Wrote #{Path.relative_to(output, root)}")
    after
      :cover.stop()
    end
  end

  def source_path!(source, root, package) do
    relative = Path.relative_to(Path.expand(source), Path.expand(root))
    prefix = "apps/#{package}/lib/"

    unless String.starts_with?(relative, prefix) and File.regular?(source) do
      raise "Coverage source is not an existing package library file: #{relative}"
    end

    relative
  end

  def to_xml(entries) do
    files =
      Enum.reduce(entries, %{}, fn
        {_path, 0, _coverage}, files ->
          files

        {path, line, {covered, uncovered}}, files
        when is_integer(line) and line > 0 and covered in [0, 1] and uncovered in [0, 1] ->
          Map.update(files, path, %{line => covered == 1}, fn lines ->
            Map.update(lines, line, covered == 1, &(&1 or covered == 1))
          end)
      end)

    if map_size(files) == 0, do: raise("Coverage contains no executable source lines")

    body =
      for {path, lines} <- Enum.sort(files) do
        rows =
          for {line, covered} <- Enum.sort(lines),
              do: ~s(    <lineToCover lineNumber="#{line}" covered="#{covered}"/>\n)

        [~s(  <file path="#{escape(path)}">\n), rows, "  </file>\n"]
      end

    IO.iodata_to_binary([
      ~s(<?xml version="1.0" encoding="UTF-8"?>\n<coverage version="1">\n),
      body,
      "</coverage>\n"
    ])
  end

  defp escape(value) do
    value
    |> String.replace("&", "&amp;")
    |> String.replace("\"", "&quot;")
    |> String.replace("<", "&lt;")
    |> String.replace(">", "&gt;")
    |> String.replace("'", "&apos;")
  end
end
