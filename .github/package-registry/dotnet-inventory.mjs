/** One inventory drives .NET package selection, dependency order and CI source roots. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function loadDotnetInventory(root = repoRoot) {
  return JSON.parse(
    fs.readFileSync(
      path.join(root, ".github/package-registry/nuget-packages.json"),
      "utf8",
    ),
  );
}

export function families(inventory) {
  return [
    { ...inventory, name: "server", families: undefined },
    ...(inventory.families ?? []),
  ];
}

export function flattenPackages(inventory) {
  const result = families(inventory).flatMap((family) =>
    family.packages.map((pkg) => ({
      ...pkg,
      family: family.name,
      sdkRoot: family.sdkRoot,
      changelog: family.changelog,
      projectPath: path.posix.join(family.sdkRoot, pkg.project),
      manifest:
        pkg.manifest ??
        (family.name === "server"
          ? path.posix.join(family.sdkRoot, "Directory.Build.props")
          : path.posix.join(family.sdkRoot, pkg.project)),
      dependencies: pkg.dependencies ?? [],
      aliases: pkg.aliases ?? [],
    })),
  );
  if (new Set(result.map((pkg) => pkg.id)).size !== result.length) {
    throw new Error("Duplicate NuGet package ID");
  }

  return result;
}

/** Topological order ensures a dependency is available before its consumer is published. */
export function orderPackages(packages) {
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];
  function visit(pkg) {
    if (visited.has(pkg.id)) {
      return;
    }

    if (visiting.has(pkg.id)) {
      throw new Error(`Dependency cycle at ${pkg.id}`);
    }

    visiting.add(pkg.id);
    for (const id of pkg.dependencies ?? []) {
      if (!byId.has(id)) {
        throw new Error(`Missing dependency ${id} for ${pkg.id}`);
      }
      visit(byId.get(id));
    }

    visiting.delete(pkg.id);
    visited.add(pkg.id);
    ordered.push(pkg);
  }

  packages.forEach(visit);
  return ordered;
}

/** Preserve legacy selectors while including the dependencies required by selected consumers. */
export function selectPackages(packages, selection = "all") {
  const ordered = orderPackages(packages);
  if (selection.trim().toLowerCase() === "all") {
    return ordered;
  }

  const selected = new Set();
  for (const selector of selection
    .split(",")
    .map((value) => value.trim().toLowerCase())) {
    const matches = packages.filter((pkg) =>
      [pkg.id, pkg.family, ...pkg.aliases].some(
        (name) => name.toLowerCase() === selector,
      ),
    );
    if (!selector || matches.length === 0) {
      throw new Error(`Unknown package or family: ${selector}`);
    }

    matches.forEach((pkg) => selected.add(pkg.id));
  }

  function addDependencies(pkg) {
    for (const id of pkg.dependencies) {
      if (!selected.has(id)) {
        selected.add(id);
        addDependencies(packages.find((item) => item.id === id));
      }
    }
  }
  packages.filter((pkg) => selected.has(pkg.id)).forEach(addDependencies);
  return ordered.filter((pkg) => selected.has(pkg.id));
}
/** Detect missing inventory records before a new package can escape analysis/publication governance. */
export function validateSources(inventory, root = repoRoot) {
  const packages = flattenPackages(inventory);
  const declared = new Set(packages.map((pkg) => pkg.projectPath));
  for (const pkg of packages) {
    for (const relative of [pkg.projectPath, pkg.manifest, pkg.changelog]) {
      if (path.isAbsolute(relative) || relative.split("/").includes("..")) {
        throw new Error(`Unsafe inventory path: ${relative}`);
      }

      if (!fs.existsSync(path.join(root, relative))) {
        throw new Error(`Missing declared source: ${relative}`);
      }
    }
  }

  const byPath = new Map(
    packages.map((pkg) => [path.resolve(root, pkg.projectPath), pkg.id]),
  );
  const byId = new Set(packages.map((pkg) => pkg.id));
  for (const pkg of packages) {
    const source = fs.readFileSync(path.join(root, pkg.projectPath), "utf8");
    const dependencies = new Set(pkg.dependencies);
    for (const match of source.matchAll(
      /<ProjectReference\s+Include="([^"]+)"/g,
    )) {
      const referenced = path.resolve(
        root,
        path.dirname(pkg.projectPath),
        match[1].replaceAll("\\", "/"),
      );
      if (byPath.has(referenced)) {
        dependencies.add(byPath.get(referenced));
      }
    }

    for (const match of source.matchAll(
      /<PackageReference\s+Include="([^"]+)"/g,
    )) {
      if (byId.has(match[1])) {
        dependencies.add(match[1]);
      }
    }
    pkg.dependencies = [...dependencies];
  }
  orderPackages(packages);
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        [
          "bin",
          "obj",
          "node_modules",
          "examples",
          "example",
          "tests",
          "Benchmarks",
        ].includes(entry.name) ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        inspect(absolute);
        continue;
      }

      if (
        !entry.name.endsWith(".csproj") ||
        /Tests|Benchmarks/.test(entry.name)
      ) {
        continue;
      }

      const source = fs.readFileSync(absolute, "utf8");
      if (
        /<IsPackable>\s*false\s*<\/IsPackable>|<OutputType>\s*(?:Exe|WinExe)\s*<\/OutputType>/i.test(
          source,
        )
      ) {
        continue;
      }

      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (!declared.has(relative)) {
        throw new Error(
          `Publishable project missing from NuGet inventory: ${relative}`,
        );
      }
    }
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("Toggly.")) {
      inspect(path.join(root, entry.name));
    }
  }

  return packages;
}
