# Publishing Guide for @ops-ai/astro-feature-flags-toggly

## Prerequisites

1. **npm Account**: You need an npm account with publish permissions for the `@ops-ai` scope
2. **npm Authentication**: Login to npm:
   ```bash
   npm login
   ```

## Pre-Publishing Checklist

- [ ] All tests pass (if you have tests)
- [ ] Build succeeds without errors
- [ ] README is up to date
- [ ] package.json version is incremented
- [ ] CHANGELOG is updated (if you maintain one)
- [ ] All dependencies are correct
- [ ] `.gitignore` and `.npmignore` are properly configured

## Publishing Steps

### 1. Clean and Build

```bash
# Clean previous builds
npm run clean

# Install dependencies
npm install

# Build the package
npm run build
```

### 2. Verify Package Contents

Before publishing, verify what will be included in the package:

```bash
npm pack --dry-run
```

This shows you exactly what files will be published. Verify that:
- `dist/` folder is included
- Source files (`src/`) are **not** included (unless intentional)
- `node_modules/` is not included
- Only necessary files are included

### 3. Test the Package Locally (Optional but Recommended)

Create a test Astro project and install your package locally:

```bash
# In the SDK directory, create a tarball
npm pack

# In a test Astro project
npm install /path/to/ops-ai-astro-feature-flags-toggly-1.0.0.tgz

# Test the integration
```

### 4. Version Management

Update the version in `package.json` following [Semantic Versioning](https://semver.org/):

- **Patch** (1.0.0 → 1.0.1): Bug fixes, no API changes
  ```bash
  npm version patch
  ```

- **Minor** (1.0.0 → 1.1.0): New features, backward compatible
  ```bash
  npm version minor
  ```

- **Major** (1.0.0 → 2.0.0): Breaking changes
  ```bash
  npm version major
  ```

The `npm version` command automatically:
- Updates `package.json` and `package-lock.json`
- Creates a git commit
- Creates a git tag

### 5. Publish to npm

#### First-time Publishing (for new packages)

```bash
npm publish --access public
```

The `--access public` flag is required for scoped packages (@ops-ai) to be publicly available.

#### Subsequent Publishes

```bash
npm publish
```

#### Publishing with Tags

For pre-release versions (alpha, beta, rc):

```bash
# Update version to pre-release
npm version prerelease --preid=beta
# Example: 1.0.0 → 1.0.1-beta.0

# Publish with beta tag
npm publish --tag beta
```

Users can install specific tags:
```bash
npm install @ops-ai/astro-feature-flags-toggly@beta
```

### 6. Post-Publishing

1. **Verify on npm**: Check https://www.npmjs.com/package/@ops-ai/astro-feature-flags-toggly

2. **Push git changes**:
   ```bash
   git push origin main --follow-tags
   ```

3. **Create GitHub Release** (if applicable):
   - Go to GitHub repository
   - Create a new release from the version tag
   - Copy relevant changelog entries

4. **Announce**: Update documentation, notify users, etc.

## Troubleshooting

### "You do not have permission to publish"

- Verify you're logged in: `npm whoami`
- Verify you have permission for the @ops-ai scope
- Contact the scope owner

### "Version already exists"

- You need to bump the version number in `package.json`
- Use `npm version` commands

### "Files are not included in package"

- Check your `package.json` `files` field
- Ensure `dist/` is included
- Run `npm pack --dry-run` to verify

### Build Errors

- Ensure all peer dependencies are installed as dev dependencies
- Run `npm install --legacy-peer-deps` if there are peer dependency conflicts
- Check `tsup.config.ts` configuration

## Version History

### 1.0.0 - Initial Release
- ✅ Astro integration with SSR/SSG support
- ✅ Native Astro components (`Feature`, `FeatureClient`)
- ✅ Server-side flag evaluation
- ✅ Client-side reactive store (nanostores)
- ✅ React integration with hooks and components
- ✅ Vue integration with composables
- ✅ Svelte integration with stores
- ✅ Frontmatter-based page gating
- ✅ Edge enforcement ready (Cloudflare Workers)
- ✅ Embedded Toggly client (no external core dependency)

## Development Workflow

### Making Changes

1. Create a feature branch
2. Make changes
3. Test locally with `npm run build`
4. Update tests (if applicable)
5. Update README if API changes
6. Commit changes
7. Push and create PR
8. After PR merge, follow publishing steps

### Publishing Cadence

- **Patches**: As needed for bug fixes (weekly/as-needed)
- **Minor**: Monthly or when new features are ready
- **Major**: Only when necessary (breaking changes)

## npm Scripts Reference

```json
{
  "build": "Build the package (tsup + copy components)",
  "dev": "Build in watch mode",
  "typecheck": "Type check without building",
  "clean": "Remove dist folder"
}
```

## Additional Resources

- [npm Publishing Guide](https://docs.npmjs.com/cli/v8/commands/npm-publish)
- [Semantic Versioning](https://semver.org/)
- [npm Scopes](https://docs.npmjs.com/cli/v8/using-npm/scope)
- [package.json files field](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#files)

