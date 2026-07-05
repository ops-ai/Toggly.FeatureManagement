#!/usr/bin/env node
/**
 * Manifest-first release version resolver.
 * Compares manifest version to registry latest and outputs publish | skip | fail.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const {
  MANIFEST_PATH,
  MANIFEST_TYPE = '',
  REGISTRY,
  PACKAGE_NAME,
  RELEASE_MODE = 'publish',
  BUMP_TYPE = 'patch',
  TAG_PREFIX = '',
  GITHUB_OUTPUT,
} = process.env;

if (!MANIFEST_PATH || !REGISTRY || !PACKAGE_NAME || !GITHUB_OUTPUT) {
  console.error('Missing required environment variables');
  process.exit(1);
}

function writeOutput(key, value) {
  fs.appendFileSync(GITHUB_OUTPUT, `${key}=${value}\n`);
}

function detectManifestType(manifestPath) {
  if (MANIFEST_TYPE) {
    return MANIFEST_TYPE;
  }
  const base = path.basename(manifestPath).toLowerCase();
  if (base === 'package.json') return 'npm';
  if (base === 'pubspec.yaml') return 'pubspec';
  if (base === 'cargo.toml') return 'cargo';
  if (base.endsWith('.csproj')) return 'csproj';
  if (base === 'directory.build.props') return 'props';
  if (base === 'pyproject.toml') return 'pyproject';
  if (base.endsWith('.gemspec')) return 'gemspec';
  if (base === 'composer.json') return 'composer';
  if (base === 'version') return 'version_file';
  if (base === 'version.rb') return 'ruby_version';
  if (base === 'gradle.properties') return 'gradle_properties';
  if (base === 'build.gradle.kts') return 'gradle_kts';
  if (base.endsWith('.swift')) return 'swift';
  throw new Error(`Cannot detect manifest type for ${manifestPath}`);
}

function normalizeVersionString(version) {
  return String(version).trim().replace(/^v+/i, '');
}

function parseVersion(version) {
  const normalized = normalizeVersionString(version);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    base: `${match[1]}.${match[2]}.${match[3]}`,
  };
}

function compareSemver(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (va.major !== vb.major) return va.major > vb.major ? 1 : -1;
  if (va.minor !== vb.minor) return va.minor > vb.minor ? 1 : -1;
  if (va.patch !== vb.patch) return va.patch > vb.patch ? 1 : -1;
  return 0;
}

function bumpSemver(version, bumpType) {
  const v = parseVersion(version);
  switch (bumpType) {
    case 'major':
      return `${v.major + 1}.0.0`;
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`;
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${bumpType}`);
  }
}

function maxSemver(a, b) {
  if (!a) return b;
  if (!b) return a;
  return compareSemver(a, b) >= 0 ? parseVersion(a).base : parseVersion(b).base;
}

function readManifestVersion(manifestPath, manifestType) {
  const content = fs.readFileSync(manifestPath, 'utf8');

  switch (manifestType) {
    case 'npm':
    case 'composer':
      return JSON.parse(content).version;
    case 'pubspec': {
      const match = content.match(/^version:\s*([^\s#+]+)/m);
      if (!match) throw new Error(`No version in ${manifestPath}`);
      return match[1].split('+')[0];
    }
    case 'cargo': {
      const workspaceMatch = content.match(/\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
      if (workspaceMatch) {
        return workspaceMatch[1];
      }
      const match = content.match(/^version\s*=\s*"([^"]+)"/m);
      if (!match) throw new Error(`No version in ${manifestPath}`);
      return match[1];
    }
    case 'csproj': {
      const match = content.match(/<Version>([^<]+)<\/Version>/i)
        || content.match(/<PackageVersion>([^<]+)<\/PackageVersion>/i);
      if (!match) throw new Error(`No Version in ${manifestPath}`);
      return match[1].trim();
    }
    case 'props': {
      const match = content.match(/<Version>([^<]+)<\/Version>/i)
        || content.match(/<PackageVersion>([^<]+)<\/PackageVersion>/i);
      if (!match) throw new Error(`No Version in ${manifestPath}`);
      return match[1].trim();
    }
    case 'pyproject': {
      const match = content.match(/^version\s*=\s*"([^"]+)"/m);
      if (!match) throw new Error(`No version in ${manifestPath}`);
      return match[1];
    }
    case 'gemspec': {
      const match = content.match(/\.version\s*=\s*['"]([^'"]+)['"]/);
      if (!match) throw new Error(`No version in ${manifestPath}`);
      return match[1];
    }
    case 'version_file': {
      const line = content.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      if (!line) throw new Error(`No version in ${manifestPath}`);
      return line.split('+')[0];
    }
    case 'ruby_version': {
      const match = content.match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (!match) throw new Error(`No VERSION in ${manifestPath}`);
      return match[1];
    }
    case 'gradle_properties': {
      const match = content.match(/^(?:version|VERSION_NAME)\s*=\s*([^\s#]+)/m);
      if (!match) throw new Error(`No version in ${manifestPath}`);
      return match[1];
    }
    case 'gradle_kts': {
      const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
      if (!match) throw new Error(`No version in ${manifestPath}`);
      return match[1];
    }
    case 'swift': {
      const match = content.match(/public let togglyVersion\s*=\s*"([^"]+)"/);
      if (!match) throw new Error(`No togglyVersion in ${manifestPath}`);
      return match[1];
    }
    default:
      throw new Error(`Unsupported manifest type: ${manifestType}`);
  }
}

function writeManifestVersion(manifestPath, manifestType, newVersion) {
  let content = fs.readFileSync(manifestPath, 'utf8');

  switch (manifestType) {
    case 'npm':
    case 'composer': {
      const data = JSON.parse(content);
      data.version = newVersion;
      fs.writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`);
      break;
    }
    case 'pubspec':
      content = content.replace(/^version:\s*.+$/m, `version: ${newVersion}`);
      fs.writeFileSync(manifestPath, content);
      break;
    case 'cargo':
      if (content.includes('[workspace.package]')) {
        content = content.replace(
          /(\[workspace\.package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
          `$1${newVersion}$2`,
        );
      } else {
        content = content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`);
      }
      fs.writeFileSync(manifestPath, content);
      break;
    case 'csproj':
      if (content.includes('<Version>')) {
        content = content.replace(/<Version>[^<]+<\/Version>/i, `<Version>${newVersion}</Version>`);
      } else if (content.includes('<PackageVersion>')) {
        content = content.replace(/<PackageVersion>[^<]+<\/PackageVersion>/i, `<PackageVersion>${newVersion}</PackageVersion>`);
      } else {
        throw new Error(`Cannot update version in ${manifestPath}`);
      }
      fs.writeFileSync(manifestPath, content);
      break;
    case 'props':
      if (content.includes('<Version>')) {
        content = content.replace(/<Version>[^<]+<\/Version>/i, `<Version>${newVersion}</Version>`);
      } else if (content.includes('<PackageVersion>')) {
        content = content.replace(/<PackageVersion>[^<]+<\/PackageVersion>/i, `<PackageVersion>${newVersion}</PackageVersion>`);
      } else {
        throw new Error(`Cannot update version in ${manifestPath}`);
      }
      fs.writeFileSync(manifestPath, content);
      break;
    case 'pyproject':
      content = content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`);
      fs.writeFileSync(manifestPath, content);
      break;
    case 'gemspec':
      content = content.replace(/\.version\s*=\s*['"][^'"]+['"]/, `.version = '${newVersion}'`);
      fs.writeFileSync(manifestPath, content);
      break;
    case 'version_file':
      fs.writeFileSync(manifestPath, `${newVersion}\n`);
      break;
    case 'ruby_version':
      content = content.replace(/VERSION\s*=\s*['"][^'"]+['"]/, `VERSION = "${newVersion}"`);
      fs.writeFileSync(manifestPath, content);
      break;
    case 'gradle_properties':
      if (/^version\s*=/m.test(content)) {
        content = content.replace(/^version\s*=.*/m, `version=${newVersion}`);
      } else if (/^VERSION_NAME\s*=/m.test(content)) {
        content = content.replace(/^VERSION_NAME\s*=.*/m, `VERSION_NAME=${newVersion}`);
      } else {
        content = `${content.trimEnd()}\nversion=${newVersion}\n`;
      }
      fs.writeFileSync(manifestPath, content);
      break;
    case 'gradle_kts':
      content = content.replace(/^\s*version\s*=\s*"[^"]+"/m, `    version = "${newVersion}"`);
      fs.writeFileSync(manifestPath, content);
      break;
    case 'swift':
      content = content.replace(
        /public let togglyVersion\s*=\s*"[^"]+"/,
        `public let togglyVersion = "${newVersion}"`,
      );
      fs.writeFileSync(manifestPath, content);
      break;
    default:
      throw new Error(`Unsupported manifest type for write: ${manifestType}`);
  }
}

class RegistryLookupError extends Error {}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'toggly-release-resolve/1.0 (ops-ai)' },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new RegistryLookupError(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function queryLatestTag(prefix) {
  if (!prefix) {
    return '';
  }
  try {
    const output = execSync(`git tag -l "${prefix}*" --sort=-version:refname`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!output) {
      return '';
    }

    let best = '';
    for (const tag of output.split('\n').filter(Boolean)) {
      if (!tag.startsWith(prefix)) {
        continue;
      }
      const suffix = normalizeVersionString(tag.slice(prefix.length));
      try {
        const version = parseVersion(suffix).base;
        if (!best || compareSemver(version, best) > 0) {
          best = version;
        }
      } catch {
        console.log(`Ignoring malformed tag suffix for ${tag}`);
      }
    }
    return best;
  } catch {
    return '';
  }
}

async function queryRegistryLatest(registry, packageName) {
  switch (registry) {
    case 'none':
      return '';
    case 'npm': {
      try {
        return execSync(`npm view "${packageName}" version`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
      } catch (error) {
        const stderr = error.stderr?.toString() ?? '';
        if (/E404|404 Not Found|Not found/i.test(stderr)) {
          return '';
        }
        throw new RegistryLookupError(
          `npm view failed for ${packageName}: ${stderr.trim() || error.message}`,
        );
      }
    }
    case 'pub': {
      const data = await fetchJson(`https://pub.dev/api/packages/${packageName}`);
      return data?.latest?.version ?? '';
    }
    case 'nuget': {
      const id = packageName.toLowerCase();
      const data = await fetchJson(`https://api.nuget.org/v3-flatcontainer/${id}/index.json`);
      if (!data) {
        return '';
      }
      const versions = (data?.versions ?? []).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
      return versions.length ? versions[versions.length - 1] : '';
    }
    case 'crates': {
      const data = await fetchJson(`https://crates.io/api/v1/crates/${packageName}`);
      if (!data) {
        return '';
      }
      return data?.crate?.max_version ?? '';
    }
    case 'pypi': {
      const data = await fetchJson(`https://pypi.org/pypi/${packageName}/json`);
      if (!data) {
        return '';
      }
      return data?.info?.version ?? '';
    }
    case 'rubygems': {
      const data = await fetchJson(`https://rubygems.org/api/v1/gems/${packageName}.json`);
      if (!data) {
        return '';
      }
      return data?.version ?? '';
    }
    case 'packagist': {
      const data = await fetchJson(`https://repo.packagist.org/p2/${packageName}.json`);
      if (!data) {
        return '';
      }
      const packages = data?.packages?.[packageName] ?? [];
      return packages[0]?.version?.replace(/^v/, '') ?? '';
    }
    default:
      throw new RegistryLookupError(`Unsupported registry: ${registry}`);
  }
}

async function main() {
  const manifestType = detectManifestType(MANIFEST_PATH);
  const manifestVersion = parseVersion(readManifestVersion(MANIFEST_PATH, manifestType)).base;
  let registryLatestRaw;
  try {
    registryLatestRaw = await queryRegistryLatest(REGISTRY, PACKAGE_NAME);
    if (REGISTRY === 'none' && TAG_PREFIX) {
      registryLatestRaw = await queryLatestTag(TAG_PREFIX);
    }
  } catch (error) {
    console.error(`Registry lookup failed (${REGISTRY}/${PACKAGE_NAME}): ${error.message}`);
    process.exit(1);
  }
  const registryLatest = registryLatestRaw ? parseVersion(registryLatestRaw).base : '';

  console.log(`Manifest: ${manifestVersion}`);
  console.log(`Registry latest (${REGISTRY}/${PACKAGE_NAME}): ${registryLatest || '(none)'}`);
  console.log(`Release mode: ${RELEASE_MODE}`);

  let version = manifestVersion;
  let action = 'publish';
  let reason = '';
  let manifestChanged = 'false';

  if (RELEASE_MODE === 'auto_bump') {
    const base = maxSemver(manifestVersion, registryLatest) || '0.0.0';
    version = bumpSemver(base, BUMP_TYPE);
    if (version !== manifestVersion) {
      writeManifestVersion(MANIFEST_PATH, manifestType, version);
      manifestChanged = 'true';
    }
    action = 'publish';
    reason = `auto_bump ${BUMP_TYPE} from ${base} -> ${version}`;
  } else {
    if (!registryLatest) {
      action = 'publish';
      reason = `manifest ${manifestVersion}; registry has no prior release`;
    } else {
      const cmp = compareSemver(manifestVersion, registryLatest);
      if (cmp > 0) {
        action = 'publish';
        reason = `manifest ${manifestVersion} is ahead of registry ${registryLatest}`;
      } else if (cmp === 0) {
        action = 'skip';
        reason = `${manifestVersion} already published on ${REGISTRY}`;
      } else {
        action = 'fail';
        reason = `manifest ${manifestVersion} is behind registry ${registryLatest}; bump version in a PR first`;
      }
    }
  }

  console.log(`Decision: ${action} — ${reason}`);

  writeOutput('version', version);
  writeOutput('action', action);
  writeOutput('reason', reason.replace(/\n/g, ' '));
  writeOutput('registry_latest', registryLatest);
  writeOutput('manifest_version', manifestVersion);
  writeOutput('manifest_changed', manifestChanged);

  if (action === 'fail') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
