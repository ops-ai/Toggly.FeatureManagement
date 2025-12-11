# Monorepo Setup for PHP Library

This document explains how the PHP library is configured to work within the Toggly monorepo.

## Current Structure

```
Toggly.FeatureManagement/
├── Toggly.FeatureManagement.NET/     # .NET libraries
├── Toggly.FeatureManagement.Javascript/ # JavaScript library
├── Toggly.FeatureManagement.React/    # React library
├── Toggly.FeatureManagement.PHP/     # PHP library ← You are here
│   ├── composer.json                  # Package definition
│   ├── src/                           # Source code
│   └── ...
└── ...
```

## Packagist Configuration

When publishing to Packagist, use the subdirectory format:

**Repository URL:**
```
https://github.com/ops-ai/Toggly.FeatureManagement.git:Toggly.FeatureManagement/Toggly.FeatureManagement.PHP
```

This tells Packagist:
- Repository: `https://github.com/ops-ai/Toggly.FeatureManagement.git`
- Subdirectory: `Toggly.FeatureManagement/Toggly.FeatureManagement.PHP`

## Version Tagging

Since this is a monorepo, you have two options:

### Option 1: Shared Version Tags (Recommended)

Use the same version tags for all SDKs:

```bash
# Tag the entire repository
git tag -a v1.0.0 -m "Release v1.0.0 - All SDKs"
git push origin v1.0.0
```

Packagist will only look at the PHP subdirectory when checking out the tag.

### Option 2: PHP-Specific Tags

Use PHP-specific tags if you want independent versioning:

```bash
# Tag with PHP prefix
git tag -a php-v1.0.0 -m "PHP SDK v1.0.0"
git push origin php-v1.0.0
```

Then configure Packagist to look for tags matching `php-v*` pattern.

## Composer.json Configuration

The `composer.json` is already configured correctly:

- ✅ `name`: `toggly/feature-management-php` (unique package name)
- ✅ `autoload`: Points to `src/` directory (relative to composer.json location)
- ✅ All paths are relative to the `composer.json` file location

## Testing Locally

You can test the package locally using Composer's path repository:

### In a Test Project

Create a `composer.json` in a test directory:

```json
{
    "repositories": [
        {
            "type": "path",
            "url": "../Toggly.FeatureManagement/Toggly.FeatureManagement.PHP"
        }
    ],
    "require": {
        "toggly/feature-management-php": "@dev"
    }
}
```

Then run:
```bash
composer install
```

This will symlink the local package for testing.

## CI/CD Considerations

If you have CI/CD pipelines:

1. **Tag Detection**: Your CI should detect tags and build/publish accordingly
2. **Path Filtering**: Only run PHP-specific tests when PHP files change:
   ```yaml
   paths:
     - 'Toggly.FeatureManagement/Toggly.FeatureManagement.PHP/**'
   ```
3. **Version Extraction**: Extract version from git tags for all SDKs

## Benefits of Monorepo

✅ **Consistency**: All SDKs stay in sync
✅ **Shared Documentation**: Easier to maintain docs
✅ **Unified Releases**: Coordinate releases across SDKs
✅ **Code Sharing**: Share common logic if needed
✅ **Single CI/CD**: One pipeline for all SDKs

## Potential Issues

⚠️ **Large Repository**: Monorepos can get large, but this is manageable
⚠️ **Tag Conflicts**: If different SDKs use different versioning schemes
⚠️ **Packagist Setup**: Slightly more complex initial setup (one-time)

## Alternative: Separate Repository

If you prefer a separate repository:

1. Create `ops-ai/toggly-feature-management-php` repository
2. Copy only PHP library files
3. Set up as independent package
4. Use GitHub Actions to sync from monorepo (optional)

But for now, **the monorepo approach is recommended** since you're already using it for other SDKs.
