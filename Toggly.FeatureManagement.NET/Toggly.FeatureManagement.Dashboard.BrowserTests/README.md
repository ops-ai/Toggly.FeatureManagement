# Embedded dashboard browser tests

These development-only tests exercise the compiled Razor dashboard in the real
SQLite sample. Dashboard package consumers do not need Node or Playwright.

With the .NET SDK and .NET 8 runtime installed, run from this directory:

```sh
npm ci
npx playwright install chromium
npm test
```

Set `TOGGLY_TEST_DOTNET` to use a different .NET executable. Set
`TOGGLY_TEST_HOST_PROJECT` to exercise a packed-package consumer exposing the same
sample routes (`/`, `/checkout`, and `/internal/features`). The host reads its
dedicated SQLite connection from `ConnectionStrings__TogglyCatalog`.

The tests launch their own host and dedicated temporary SQLite database. They
cover desktop Chromium and a narrow viewport with JavaScript disabled. The
lifecycle checks keyboard navigation, rule preservation, literal identifiers,
escaped markup, export/import, immediate evaluation, and deletion. Browser
requests to remote origins are blocked and reported. This browser check alone
does not prove the absence of server-side network activity; runtime registration
and offline integration tests provide separate evidence.

Failure traces and screenshots are written under `test-results/` and excluded
from Git. The sample database is isolated in the OS temporary directory.

To test a clean application using packed packages, build and pack the solution,
then run from the repository root:

```sh
python3 Toggly.FeatureManagement.NET/scripts/verify-embedded-packages.py --feed /path/to/candidate-nupkgs --framework net8.0
python3 Toggly.FeatureManagement.NET/scripts/verify-embedded-packages.py --feed /path/to/candidate-nupkgs --framework net10.0
```

The script reads versions from the artifacts, uses an isolated NuGet cache,
and creates no project references or host Razor source. CI runs the same checks
against its uploaded package artifacts. These are local-artifact checks, not
public NuGet publication tests.
