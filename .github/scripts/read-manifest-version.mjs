#!/usr/bin/env node
/**
 * Shared manifest version reader used by release resolution and Sonar scans.
 */

import fs from 'node:fs';
import path from 'node:path';

export function detectManifestType(manifestPath, override = '') {
  if (override) {
    return override;
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
  if (base === 'pom.xml') return 'pom';
  if (base.endsWith('.swift')) return 'swift';
  throw new Error(`Cannot detect manifest type for ${manifestPath}`);
}

export function readManifestVersion(manifestPath, manifestType) {
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
    case 'pom': {
      const withoutParent = content.replace(/<parent>[\s\S]*?<\/parent>/, '');
      const match = withoutParent.match(/<version>\s*([^<]+?)\s*<\/version>/i);
      if (!match) throw new Error(`No project version in ${manifestPath}`);
      return match[1].trim();
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
