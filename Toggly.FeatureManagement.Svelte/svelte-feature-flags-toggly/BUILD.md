# Build and Publishing Guide

This document provides detailed instructions for building and publishing the `@ops-ai/svelte-feature-flags-toggly` package.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Building the Library](#building-the-library)
- [Testing the Build](#testing-the-build)
- [Publishing to npm](#publishing-to-npm)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

- **Node.js**: Version 18 or higher
- **npm**: Version 9 or higher (comes with Node.js)
- **Git**: For version control and tagging

### Required Accounts

- **npm account** with access to the `@ops-ai` organization
- **GitHub account** (if contributing to the repository)

## Building the Library

### Step 1: Install Dependencies

```bash
npm install
```

This installs all development dependencies including:
- TypeScript
- Vite and Svelte plugins
- Svelte compiler
- Type checking tools

### Step 2: Type Checking

Before building, verify there are no TypeScript errors:

```bash
npm run typecheck
```

This runs `svelte-check` to validate all TypeScript and Svelte files.

### Step 3: Build the Library

Build the library for production:

```bash
npm run build
```

This command:
1. Compiles TypeScript source files to JavaScript
2. Processes Svelte components
3. Bundles the library for both ESM and CommonJS formats
4. Generates TypeScript declaration files (`.d.ts`)
5. Outputs everything to the `dist/` directory

### Build Output Structure

After a successful build, the `dist/` directory should contain:

```
dist/
├── svelte-feature-flags-toggly.es.js    # ES Module build
├── svelte-feature-flags-toggly.cjs      # CommonJS build
├── index.js                              # Svelte component entry
├── types/                                # TypeScript declarations
│   ├── index.d.ts
│   ├── services/
│   ├── stores/
│   ├── components/
│   └── utils/
└── ...
```

### Build Configuration

The build is configured in:
- **`vite.config.ts`**: Vite build configuration
- **`tsconfig.json`**: TypeScript compiler options
- **`svelte.config.js`**: Svelte compiler options

## Testing the Build

### Option 1: Test with Example App

The example app in the `example/` directory can be used to test the built library:

```bash
cd example
npm install
npm run dev
```

Visit `http://localhost:5173` to see the example application.

### Option 2: Test with npm link

You can test the package in another project using `npm link`:

1. **In the library directory:**
   ```bash
   npm link
   ```

2. **In your test project:**
   ```bash
   npm link @ops-ai/svelte-feature-flags-toggly
   ```

3. **Import and use:**
   ```typescript
   import { createToggly, Feature } from '@ops-ai/svelte-feature-flags-toggly'
   ```

4. **Unlink when done:**
   ```bash
   # In test project
   npm unlink @ops-ai/svelte-feature-flags-toggly
   
   # In library directory
   npm unlink
   ```

### Option 3: Local Package Installation

You can install the package directly from the local directory:

```bash
# In your test project
npm install /path/to/svelte-feature-flags-toggly
```

## Publishing to npm

### Pre-Publishing Checklist

Before publishing, ensure:

- [ ] All tests pass (if applicable)
- [ ] Version number is updated in `package.json`
- [ ] `CHANGELOG.md` is updated with new version and changes
- [ ] `README.md` is accurate and up to date
- [ ] Build completes without errors
- [ ] TypeScript declarations are generated correctly
- [ ] `.npmignore` is configured correctly
- [ ] License file is present

### Step 1: Update Version

Update the version in `package.json` following [Semantic Versioning](https://semver.org/):

- **Patch** (1.0.0 → 1.0.1): Bug fixes, no breaking changes
- **Minor** (1.0.0 → 1.1.0): New features, backward compatible
- **Major** (1.0.0 → 2.0.0): Breaking changes

You can use npm's version command:

```bash
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0
```

This automatically:
- Updates `package.json`
- Creates a git commit
- Creates a git tag

Or manually edit `package.json`:

```json
{
  "version": "1.0.1"
}
```

### Step 2: Update CHANGELOG

Update `CHANGELOG.md` with the new version:

```markdown
## [1.0.1] - 2024-01-15

### Fixed
- Fixed issue with feature flag evaluation
- Improved error handling

### Changed
- Updated dependencies
```

### Step 3: Build the Library

Ensure the library is built with the latest changes:

```bash
npm run build
```

Verify the build output:

```bash
ls -la dist/
```

### Step 4: Verify npm Authentication

Ensure you're logged in to npm:

```bash
npm whoami
```

If not logged in:

```bash
npm login
```

Enter your npm credentials when prompted.

### Step 5: Verify Package Contents

Check what will be published:

```bash
npm pack --dry-run
```

This creates a tarball and shows what files will be included. Verify that:
- Source files are excluded (via `.npmignore`)
- Only `dist/` and necessary files are included
- No sensitive information is included

### Step 6: Dry Run Publish

Test the publish process without actually publishing:

```bash
npm publish --dry-run --access public
```

Review the output to ensure everything looks correct.

### Step 7: Publish to npm

Publish the package:

```bash
npm publish --access public
```

**Important**: The `--access public` flag is required for scoped packages (`@ops-ai/...`) to be published publicly.

### Step 8: Verify Publication

1. **Check npm registry:**
   Visit `https://www.npmjs.com/package/@ops-ai/svelte-feature-flags-toggly`

2. **Verify version:**
   The new version should appear in the versions list

3. **Test installation:**
   ```bash
   npm install @ops-ai/svelte-feature-flags-toggly@latest
   ```

### Step 9: Create Git Tag (if not done automatically)

If you used `npm version`, the tag was created automatically. Otherwise:

```bash
git tag v1.0.1
git push origin v1.0.1
```

### Step 10: Update Documentation

If this is a significant release:
- Update the main Toggly documentation
- Update any integration guides
- Announce the release (if applicable)

## Publishing Workflow Summary

```bash
# 1. Update version
npm version patch  # or minor, or major

# 2. Update CHANGELOG.md manually

# 3. Build
npm run build

# 4. Verify
npm pack --dry-run

# 5. Publish
npm publish --access public

# 6. Push tags (if npm version didn't do it)
git push --tags
```

## Troubleshooting

### Build Issues

**Error: "Cannot find module 'svelte'"**
- Run `npm install` to ensure all dependencies are installed

**Error: TypeScript compilation errors**
- Run `npm run typecheck` to see detailed errors
- Fix TypeScript errors before building

**Build output is empty or incomplete**
- Check `vite.config.ts` configuration
- Verify entry point in `package.json`
- Check for build errors in console output

### Publishing Issues

**Error: "You do not have permission to publish '@ops-ai/svelte-feature-flags-toggly'"**
- Verify you're logged in: `npm whoami`
- Check you have publish access to `@ops-ai` organization
- Contact organization admin for access

**Error: "Package name already exists"**
- The version you're trying to publish already exists
- Increment the version number
- Check existing versions: `npm view @ops-ai/svelte-feature-flags-toggly versions`

**Error: "Invalid package name"**
- Verify `package.json` has correct name format
- Scoped packages must be: `@scope/package-name`

**Error: "Missing required field: repository"**
- Add repository information to `package.json`:
  ```json
  {
    "repository": {
      "type": "git",
      "url": "git+https://github.com/ops-ai/Toggly.FeatureManagement.git"
    }
  }
  ```

### Common Mistakes

1. **Forgetting to build before publish**
   - Always run `npm run build` before publishing

2. **Publishing with uncommitted changes**
   - Commit or stash changes before versioning

3. **Wrong version number**
   - Double-check version in `package.json` matches intended release

4. **Missing files in dist/**
   - Verify build completed successfully
   - Check `.npmignore` isn't excluding necessary files

## Additional Resources

- [npm Publishing Guide](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)
- [Semantic Versioning](https://semver.org/)
- [npm Version Command](https://docs.npmjs.com/cli/v8/commands/npm-version)
- [Scoped Packages](https://docs.npmjs.com/cli/v8/using-npm/scope)

## Support

For issues or questions about building or publishing:
- Check the main [README.md](./README.md)
- Review [CHANGELOG.md](./CHANGELOG.md) for recent changes
- Open an issue on the repository
