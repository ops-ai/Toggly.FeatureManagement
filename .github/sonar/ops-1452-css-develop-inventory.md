# OPS-1452 HTML/CSS integration develop inventory

Inventory captured from `origin/develop` at `8c9f763ca2519158184ce4160e4baa8304c298dd`
on 2026-09-28. `Toggly.FeatureManagement.Css` is a static integration, not an
executable or publishable SDK package: it contains a README, MIT license, and a
single HTML demonstration page that links to hosted `defs.css`. It has no
package manifest, runtime source module, build command, or test runner.

| Asset | SHA-256 |
| --- | --- |
| `Toggly.FeatureManagement.Css/README.md` | `fd6b77779a65421115c403063fdb35e8ce9202a4e6a2cff4dce0884ca2050660` |
| `Toggly.FeatureManagement.Css/LICENSE` | `ccf7d41e5edeecf4ed635ef42e9db2bde71fa1d16039adef0a8da33bf61296ce` |
| `Toggly.FeatureManagement.Css/Demo.Css/index.html` | `f4c2acb6a4d5379ee8f8c876d482f2d75ea5bd20abf345a135fcd81278bb4d23` |

## Analysis mapping

The only repository analysis workflow that names this directory is
`.github/workflows/analysis-javascript.yml`. Its SonarCloud and self-hosted
SonarQube Server scans both exclude `Toggly.FeatureManagement.Css/**`. The
directory is also absent from the scans' `sonar.sources`, `sonar.tests`, and
the `analysis-js-filter.mjs` package matrix. Consequently, it cannot create
findings or affect coverage in the `toggly-sdks-javascript` project through
the current workflow.

The public SonarCloud search returned no project matching the CSS integration.
No authenticated self-hosted SonarQube Server export was available to this
slice. That absence is recorded as unavailable external evidence, rather than
as evidence of zero historical Server findings.

## Coverage disposition

| Scope | Executable production lines | Required line coverage | Result |
| --- | ---: | ---: | --- |
| `Toggly.FeatureManagement.Css` | 0 | Not applicable | No executable package exists, so no coverage target or test suite is valid. |

Adding a package manifest, synthetic runner, or tests here solely to report a
percentage would create a new SDK contract and misrepresent static assets as
executable production code. No source exclusion, quality-gate, or coverage
threshold changed in this slice.

## Local verification

- `node --test .github/workflows/analysis-javascript.test.mjs` passed (13 tests).
- `node .github/package-registry/analysis-js-filter.mjs all` returned no CSS
  package row.
- `git ls-files Toggly.FeatureManagement.Css/**` returned only the three assets
  listed above.

Hosted exact-head analysis remains the authoritative check if a future change
adds executable CSS-integration code or a dedicated scanner mapping.
