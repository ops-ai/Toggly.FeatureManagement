# Packed Angular acceptance tests

Run the package workspace with Node 24.18.0 (or Node 22.23.2), then run
`npm run build` and `npm run test:hosts`. The runner selects the exact Node/npm
pair for each Angular host in `matrix.json`; the parent runtime executes the
TypeScript test drivers with native type stripping. Each host still compiles
its application with its own locked Angular/TypeScript compiler and strict
public declaration checks.

The `*.spec.ts` entry points, shared host and browser driver are acceptance
tests. `test:hosts` executes them through real production bundles and Chrome;
they are not part of the published SDK or its Karma source suite. This naming
also lets the existing repository test classification recognize their purpose.
No assertion is skipped by the naming convention.

`npm test` runs the normal Angular command with its supplied arguments. Its
post-test hook verifies trusted npm executable selection and rebuilds the real
Angular 15-compatible package under c8. Measured build-tool coverage is appended
to the Angular LCOV file when that file exists, so the repository's existing
single-report-per-SDK collector receives both records. Test drivers themselves
are not production coverage targets. Coverage thresholds and source-suite
collection are unchanged.
