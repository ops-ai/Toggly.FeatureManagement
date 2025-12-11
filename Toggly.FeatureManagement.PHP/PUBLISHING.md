# Publishing Guide for Toggly PHP Library

This guide outlines the steps needed to package and publish the Toggly PHP library to Packagist (the main PHP package repository).

## Repository Structure

The PHP library lives in a **monorepo** alongside other Toggly SDKs (`.NET`, `JavaScript`, `React`, etc.). This is perfectly fine for Packagist - you can publish from a subdirectory.

**Current location**: `Toggly.FeatureManagement/Toggly.FeatureManagement.PHP/`

## Prerequisites

1. **GitHub/GitLab Repository**: The library should be in a Git repository (can be monorepo)
2. **Packagist Account**: Create an account at [packagist.org](https://packagist.org)
3. **GitHub/GitLab Integration**: Connect your repository to Packagist

## Monorepo vs Separate Repository

### Option 1: Monorepo (Recommended - Current Setup)

**Pros:**
- ✅ All SDKs in one place
- ✅ Shared versioning and releases
- ✅ Easier to maintain consistency
- ✅ Single CI/CD pipeline

**Cons:**
- ⚠️ Slightly more complex Packagist setup (need to specify subdirectory)

**Packagist Configuration:**
When submitting to Packagist, use the subdirectory format:
```
https://github.com/ops-ai/Toggly.FeatureManagement.git:Toggly.FeatureManagement/Toggly.FeatureManagement.PHP
```

### Option 2: Separate Repository

**Pros:**
- ✅ Simpler Packagist setup
- ✅ Independent versioning
- ✅ Cleaner package page

**Cons:**
- ❌ More repositories to manage
- ❌ Harder to keep SDKs in sync

**If you choose this option**, you would:
1. Create a new repository: `ops-ai/toggly-feature-management-php`
2. Copy only the PHP library files
3. Set up as a separate package

## Pre-Publishing Checklist

### 1. Verify composer.json

Ensure `composer.json` has all required fields:

- ✅ `name`: `toggly/feature-management-php`
- ✅ `description`: Clear description
- ✅ `license`: `MIT` (or your chosen license)
- ✅ `authors`: Author information
- ✅ `require`: PHP version and dependencies
- ✅ `autoload`: PSR-4 autoloading configured
- ✅ `keywords`: Relevant keywords for discoverability

### 2. Add Repository Information

Add repository information to `composer.json`:

```json
{
    "name": "toggly/feature-management-php",
    "description": "Toggly Feature Management library for PHP with Laravel and WordPress support",
    "type": "library",
    "keywords": [
        "toggly",
        "feature-flags",
        "feature-management",
        "feature-toggles",
        "ab-testing",
        "laravel",
        "wordpress"
    ],
    "license": "MIT",
    "authors": [
        {
            "name": "opsAI LLC",
            "email": "support@toggly.io"
        }
    ],
    "homepage": "https://github.com/ops-ai/Toggly.FeatureManagement",
    "support": {
        "issues": "https://github.com/ops-ai/Toggly.FeatureManagement/issues",
        "source": "https://github.com/ops-ai/Toggly.FeatureManagement"
    },
    "require": {
        "php": "^7.4|^8.0|^8.1|^8.2|^8.3",
        "psr/container": "^1.0|^2.0",
        "psr/http-client": "^1.0",
        "psr/http-factory": "^1.0",
        "psr/simple-cache": "^1.0|^2.0|^3.0",
        "psr/log": "^1.0|^2.0|^3.0"
    },
    "require-dev": {
        "phpunit/phpunit": "^9.0|^10.0"
    },
    "suggest": {
        "react/socket": "For WebSocket support",
        "guzzlehttp/guzzle": "PSR-18 HTTP client implementation",
        "symfony/http-client": "Alternative PSR-18 HTTP client",
        "illuminate/support": "For Laravel integration",
        "illuminate/http": "For Laravel HTTP integration"
    },
    "autoload": {
        "psr-4": {
            "Toggly\\FeatureManagement\\": "src/Toggly/FeatureManagement/",
            "Toggly\\Laravel\\": "src/Toggly/Laravel/",
            "Toggly\\WordPress\\": "src/Toggly/WordPress/"
        }
    },
    "autoload-dev": {
        "psr-4": {
            "Toggly\\FeatureManagement\\Tests\\": "tests/"
        }
    },
    "config": {
        "sort-packages": true,
        "preferred-install": "dist",
        "optimize-autoloader": true
    },
    "minimum-stability": "stable",
    "prefer-stable": true
}
```

### 3. Ensure Required Files Exist

- ✅ `composer.json` - Package definition
- ✅ `LICENSE` - MIT license file
- ✅ `README.md` - Comprehensive documentation
- ✅ `.gitignore` - Exclude vendor, build artifacts
- ✅ `CHANGELOG.md` - Version history

### 4. Version Tagging

Use semantic versioning (SemVer):

```bash
# Create a git tag for the version
git tag -a v1.0.0 -m "Initial release"
git push origin v1.0.0
```

Version format: `v1.0.0`, `v1.0.1`, `v1.1.0`, `v2.0.0`, etc.

## Publishing Steps

### Step 1: Verify Repository Structure

Since you're using a monorepo, ensure:
- The PHP library is in `Toggly.FeatureManagement/Toggly.FeatureManagement.PHP/`
- The `composer.json` is at the root of that directory
- All source files are in `src/` directory
- The repository is already on GitHub/GitLab

### Step 2: Create Initial Release

1. Go to GitHub repository
2. Click "Releases" > "Create a new release"
3. Tag: `v1.0.0`
4. Title: `v1.0.0 - Initial Release`
5. Description: Copy from CHANGELOG.md
6. Publish release

### Step 3: Register on Packagist (Monorepo)

1. Go to [packagist.org](https://packagist.org)
2. Click "Submit" in the top menu
3. Enter repository URL with subdirectory:
   ```
   https://github.com/ops-ai/Toggly.FeatureManagement.git:Toggly.FeatureManagement/Toggly.FeatureManagement.PHP
   ```
4. Click "Check" to verify
5. Packagist will detect the `composer.json` in the subdirectory
6. Click "Submit" to register

**Note**: The format is `REPO_URL:SUBDIRECTORY_PATH`

### Step 4: Enable Auto-Update (Recommended)

1. In Packagist, go to your package page
2. Click "Settings"
3. Enable "GitHub Service Hook" or "GitLab Service Hook"
4. This will auto-update Packagist when you push tags

**For monorepos**, the webhook will work correctly - Packagist will check the subdirectory when tags are pushed.

Alternatively, use the Packagist API:

```bash
curl -X POST https://packagist.org/api/update-package?username=YOUR_USERNAME&apiToken=YOUR_TOKEN \
  -d '{"repository":{"url":"https://github.com/ops-ai/Toggly.FeatureManagement.git:Toggly.FeatureManagement/Toggly.FeatureManagement.PHP"}}'
```

### Step 5: Verify Installation

Test that the package can be installed:

```bash
# Create a test project
mkdir test-toggly
cd test-toggly
composer init

# Require the package
composer require toggly/feature-management-php

# Verify it works
composer show toggly/feature-management-php
```

## Post-Publishing

### 1. Update Documentation

- Update README.md with installation instructions
- Add badges to README (Packagist version, downloads, etc.)
- Update documentation site with package name

### 2. Add Badges to README

```markdown
[![Latest Version on Packagist](https://img.shields.io/packagist/v/toggly/feature-management-php.svg)](https://packagist.org/packages/toggly/feature-management-php)
[![Total Downloads](https://img.shields.io/packagist/dt/toggly/feature-management-php.svg)](https://packagist.org/packages/toggly/feature-management-php)
[![License](https://img.shields.io/packagist/l/toggly/feature-management-php.svg)](https://packagist.org/packages/toggly/feature-management-php)
```

### 3. Set Up CI/CD (Optional but Recommended)

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php: [7.4, 8.0, 8.1, 8.2, 8.3]
    steps:
      - uses: actions/checkout@v3
      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
      - name: Install dependencies
        run: composer install
      - name: Run tests
        run: composer test
```

## Version Management

### Creating New Versions

1. Update `CHANGELOG.md` with changes
2. Update version in `composer.json` (if needed, though Packagist uses git tags)
3. Commit changes:

```bash
git add CHANGELOG.md
git commit -m "Prepare for v1.0.1"
```

4. Create and push tag:

```bash
git tag -a v1.0.1 -m "Release v1.0.1"
git push origin v1.0.1
```

5. Create GitHub release (if auto-update is enabled, this happens automatically)

## Alternative: Private Package Repository

If you want to keep the package private, you can:

1. Use a private Packagist instance
2. Use Satis (self-hosted Composer repository)
3. Use a private Git repository with Composer

## Troubleshooting

### Package Not Found

- Verify the repository URL is correct
- Check that the repository is public (or Packagist has access)
- Ensure the repository has at least one tag

### Auto-Update Not Working

- Verify webhook is configured in GitHub/GitLab
- Check Packagist settings for the package
- Manually trigger update via API

### Installation Issues

- Verify PHP version compatibility
- Check that all dependencies are available
- Ensure autoload paths are correct

## Next Steps

After publishing:

1. ✅ Announce the release on your website/blog
2. ✅ Update documentation site
3. ✅ Share on social media/communities
4. ✅ Monitor for issues and feedback
5. ✅ Plan next version based on feedback
