Code.require_file("sonar_coverage.ex", __DIR__)
ExUnit.start()

defmodule Toggly.SonarCoverageTest do
  use ExUnit.Case, async: false
  alias Toggly.SonarCoverage

  test "serializes native lines deterministically without inventing branches" do
    xml =
      SonarCoverage.to_xml([
        {"apps/toggly/lib/z.ex", 4, {0, 1}},
        {"apps/toggly/lib/a.ex", 2, {1, 0}},
        {"apps/toggly/lib/a.ex", 0, {0, 1}},
        {"apps/toggly/lib/a.ex", 2, {0, 1}}
      ])

    assert xml =~ ~s(<lineToCover lineNumber="2" covered="true"/>)
    assert xml =~ ~s(<lineToCover lineNumber="4" covered="false"/>)
    refute xml =~ ~s(lineNumber="0")
    refute xml =~ "branches"
    assert length(Regex.scan(~r/lineNumber="2"/, xml)) == 1
    assert :binary.match(xml, "a.ex") < :binary.match(xml, "z.ex")
  end

  test "escapes XML attributes" do
    assert SonarCoverage.to_xml([{"a&\"<>'", 1, {1, 0}}]) =~ "a&amp;&quot;&lt;&gt;&apos;"
  end

  test "rejects empty and invalid coverage instead of producing a success report" do
    assert_raise RuntimeError, fn -> SonarCoverage.to_xml([]) end
    assert_raise RuntimeError, fn -> SonarCoverage.to_xml([{"a", 0, {1, 0}}]) end
    assert_raise FunctionClauseError, fn -> SonarCoverage.to_xml([{"a", -1, {1, 0}}]) end
  end

  test "accepts only existing source files in the package library" do
    root = Path.expand("..", __DIR__)
    source = Path.join(root, "apps/toggly/lib/toggly.ex")
    assert SonarCoverage.source_path!(source, root, "toggly") == "apps/toggly/lib/toggly.ex"
    assert_raise RuntimeError, fn -> SonarCoverage.source_path!(__ENV__.file, root, "toggly") end

    assert_raise RuntimeError, fn ->
      SonarCoverage.source_path!(source, root, "toggly_phoenix")
    end

    assert_raise RuntimeError, fn ->
      SonarCoverage.source_path!(source <> ".missing", root, "toggly")
    end
  end

  test "fails for absent package builds and exports" do
    assert_raise RuntimeError, ~r/Missing compiled BEAM/, fn ->
      SonarCoverage.export_package(System.tmp_dir!(), "nonexistent-toggly-package")
    end
  end

  test "imports real native coverage and rejects partial module exports" do
    root = Path.join(System.tmp_dir!(), "toggly-sonar-#{System.unique_integer([:positive])}")
    lib = Path.join(root, "apps/fixture/lib")
    ebin = Path.join(root, "_build/test/lib/fixture/ebin")
    cover = Path.join(root, "apps/fixture/cover")
    Enum.each([lib, ebin, cover], &File.mkdir_p!/1)

    on_exit(fn ->
      :cover.stop()
      File.rm_rf!(root)
    end)

    source = Path.join(lib, "fixture.ex")

    File.write!(
      source,
      "defmodule SonarCoverageFixture do\n  def hit(true), do: :yes\n  def hit(false), do: :no\nend\n"
    )

    [{module, binary}] = Code.compile_file(source)
    beam = Path.join(ebin, "#{module}.beam")
    File.write!(beam, binary)
    {:ok, _} = :cover.start()
    {:ok, ^module} = :cover.compile_beam(String.to_charlist(beam))
    assert apply(module, :hit, [true]) == :yes
    :ok = :cover.export(String.to_charlist(Path.join(cover, "sonar.coverdata")))
    :cover.stop()

    SonarCoverage.export_package(root, "fixture")
    xml = File.read!(Path.join(cover, "sonar-coverage.xml"))
    assert xml =~ ~s(path="apps/fixture/lib/fixture.ex")
    assert xml =~ ~s(lineNumber="2" covered="true")
    assert xml =~ ~s(lineNumber="3" covered="false")

    extra = Path.join(lib, "extra.ex")
    File.write!(extra, "defmodule SonarCoverageExtra do\n  def value, do: 1\nend\n")
    [{extra_module, extra_binary}] = Code.compile_file(extra)
    File.write!(Path.join(ebin, "#{extra_module}.beam"), extra_binary)

    assert_raise RuntimeError, ~r/does not contain every compiled module/, fn ->
      SonarCoverage.export_package(root, "fixture")
    end
  end
end
