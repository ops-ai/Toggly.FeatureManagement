# Toggly for NestJS

HTTP integration for NestJS 10/11 on Node 20+. `@ops-ai/toggly-nestjs` wraps `@ops-ai/toggly-node-core` 0.9.1+, sharing its evaluator, signed definitions, snapshots, streaming and telemetry.

```sh
npm install @ops-ai/toggly-nestjs reflect-metadata rxjs
```

## Configure once

```ts
import { Module } from '@nestjs/common';
import { TogglyModule } from '@ops-ai/toggly-nestjs';

@Module({
  imports: [TogglyModule.forRoot({
    appKey: process.env.TOGGLY_APP_KEY,
    environment: process.env.TOGGLY_ENVIRONMENT ?? 'Production',
    verifySignatures: true,
    featureDefaults: { 'new-dashboard': false },
    contextFactory: (request: { user?: { id: string; groups: string[]; claims: Record<string, string> } }) => ({
      identity: request.user?.id ?? 'anonymous',
      groups: request.user?.groups,
      claims: request.user?.claims,
    }),
  })],
})
export class AppModule {}
```

`forRootAsync({ imports, inject, useFactory })` supports ConfigModule/ConfigService or any async configuration provider. `providers` optionally supplies additional configuration providers. Set `isGlobal: true` on either registration to export globally; otherwise import the registered module from the module containing your controllers. Register one root per application. The async factory completes core initialization before consumers are constructed.

`contextFactory` runs once at the first evaluation in each HTTP request, after your authentication layer has populated the request. Its result is cloned; `TogglyService` is request-scoped and consumers inherit that scope. Missing identity becomes the explicit shared value `anonymous`. There is no automatic trust in query parameters, headers, JWTs, or country fields. Return `request: { userAgent, acceptLanguage, country }` for HTTP segment filters from your trusted source. Use different identities for distinct anonymous visitors when sticky rollout separation is required. Never call `provider.client.setIdentity` from HTTP handlers.

## Declarative and programmatic evaluation

```ts
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { TogglyService, FeatureFlag, FeatureFlagGuard, FeatureEnabled } from '@ops-ai/toggly-nestjs';

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(TogglyService) private readonly toggly: TogglyService) {}

  @Get()
  @UseGuards(FeatureFlagGuard)
  @FeatureFlag(['new-dashboard', 'api-v2'], { requirement: 'any' })
  show(@FeatureEnabled('enhanced-submit') enhancedSubmit: boolean) {
    return { enhancedSubmit };
  }

  @Get('legacy')
  @UseGuards(FeatureFlagGuard)
  @FeatureFlag('api-v2', { negate: true })
  legacy() { return { version: 1 }; }

  @Get('status')
  async status() {
    return { enabled: await this.toggly.isFeatureOn('new-dashboard') };
  }
}
```

FeatureFlag accepts a nonempty string or array. Pair it with FeatureFlagGuard on the controller or method. Method metadata overrides controller metadata. Disabled defaults to **404**; `{ disabledStatus: 403 }` changes that to **403**. A thrown evaluation/context error yields **503**, without exposing the original error. A refresh failure preserved by core is not a thrown evaluation error: guards continue evaluating last-known-good definitions or defaults. Guards support HTTP only; rollout gates complement authentication and authorization.

`isFeatureOn(key, overrides?)`, `isFeatureOff(key, overrides?)` and `evaluateFeatureGate(keys, requirement = 'all', negate = false, overrides?)` return promises. All requires every flag; any requires at least one. Empty programmatic gates allow by core convention. Negation inverts the combined result. Missing flags use `featureDefaults` or false. Boolean content branches are not an experiment-assignment API.

## Context overrides and entities

```ts
const enabled = await toggly.isFeatureOn('ExpressCheckout', {
  entity: { kind: 'Order', key: 'ord-vip', attributes: { Vip: true, Total: 199 } },
});
const forAlice = await toggly.isFeatureOn('beta-access', {
  context: { identity: 'alice' },
});
```

`overrides.context` replaces supplied top-level context fields for that call (nested claims/request values replace that whole field); it never changes ambient identity. `context()` returns a fresh clone. For domain objects, register a mapper once with `provider.client.registerContext('Order', order => ({ kind: 'Order', key: order.Id, attributes: { Vip: order.Vip } }))`, then pass `{ entity: order, kind: 'Order' }`. A raw object requires that mapper; canonical `{ kind, key, attributes }` works directly. ContextProperty rules require the feature's context kind and supplied entity kind to match.

## Reliability, lifecycle and telemetry

Inject singleton `TogglyProvider` for `provider.client` and `provider.state`. `initialized` means startup completed, including defaults/cache fallback. Check `state.error`, `lastRefresh` and `definitions` to distinguish a degraded fetch. Missing app keys use defaults without network. Core defaults to a 180000ms refresh and streaming when configured; `refreshInterval: 0` and `enableStreaming: false` disable those channels independently. `client.refresh()` triggers a manual refresh and preserves last-known-good definitions on network/verification failure. `onError(error, context)` observes failures.

All Node server configuration is accepted, including `verifySignatures`, `allowedKeyIds`, `maxSignatureAgeSeconds`, `timeout`, `cacheProvider` and `enableFileCache`/`fileCachePath`. Exported `FileCacheProvider`/`MemoryCacheProvider` support snapshots; durable storage must be application-controlled. The core persists parsed definitions and startup reads that trusted cache; signature validation protects downloaded envelopes and is not re-applied to raw local cache entries. Hooks such as `afterRefresh` and `afterEvaluation` pass through to core.

`TogglyService.recordUsage(key, variant?)` and `recordView(key, variant?)` bind request identity. `provider.client.measure`, `incrementCounter`, `observe` and `flushTelemetry` expose core business metrics. Usage and metrics default on when an app key is supplied; turn them off explicitly for local fixture work. `metricsBaseUrl` is separate from definitions `baseUrl`. Hook evaluation context follows core's hook contract (identity/groups/traits), while evaluator context also receives claims/request fields.

Call `app.enableShutdownHooks()` in your Nest bootstrap for process signals; `app.close()` also triggers cleanup. The singleton shutdown hook awaits core close, flushing telemetry and releasing timers/sockets. Unexpected thrown initialization errors close the partially created client before propagating. No request-scoped lifecycle hooks are relied upon.

The HTTP adapter does not provide a Terminus indicator, response-transform interceptor, GraphQL context, WebSocket gateway or job integration. Read provider state in application-owned health checks and avoid injecting request-scoped services into singleton gateways/jobs. See [Nest injection scopes](https://docs.nestjs.com/fundamentals/injection-scopes).

## Runnable example and checks

See [`examples/app.ts`](examples/app.ts) and the [full NestJS sample](https://github.com/ops-ai/Toggly.Samples/tree/develop/nestjs-sdk). The sample includes a first-toggle exercise, shared filter presets and offline transport tests.

```sh
npm install
npm run typecheck
npm run build
npm run test:coverage
```

Tests exercise real Nest HTTP requests and loopback definition/WebSocket servers; offline fixtures do not establish production connectivity. [Customer guide](https://docs.toggly.io/sdks/nestjs).
