# Packed SolidStart integration host

Install Chromium with `npx --prefix tests/host playwright install chromium` after the host dependencies exist.

Node 24+, SolidStart 2.0.5, native server rendering/hydration and Chromium. Run `npm run test:host` from the SDK package. It builds and installs an actual npm pack into this host, builds production output, runs a local canonical ES256 service and checks concurrent guarded HTTP actions, SSR, client navigation, live invalidation, signatures, offline retention, disposal and bundle boundaries.

The fixture's synthetic frontend/backend keys are deliberately local test inputs. No production service is contacted. Backend test identity headers and query arguments are not authentication examples; the full sample describes principal/session boundaries.

Optional `TOGGLY_NODE_CORE_TARBALL` and `TOGGLY_SIGNED_DEFS_TARBALL` supply explicit reviewed upstream candidates for local verification. They affect only node_modules and are never saved to manifests or locks. Without these overrides, installation resolves the normal registry dependencies. Candidate artifact success is not registry-install or hosted evidence.
