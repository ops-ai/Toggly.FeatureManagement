# @ops-ai/ngx-feature-flags-toggly

Angular SDK for [Toggly](https://toggly.io) feature flags. Supports Angular 15-22.

<p align="center">
  <a href="https://www.npmjs.com/package/@ops-ai/ngx-feature-flags-toggly"><img src="https://img.shields.io/npm/v/@ops-ai/ngx-feature-flags-toggly.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## Installation

```bash
npm install @ops-ai/ngx-feature-flags-toggly
```

## Quick Start

### Standalone Applications (Angular 15+, Recommended)

```typescript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { provideToggly } from '@ops-ai/ngx-feature-flags-toggly';

export const appConfig: ApplicationConfig = {
  providers: [
    provideToggly({
      appKey: 'your-app-key',
      environment: 'Production'
    })
  ]
};
```

### NgModule Applications

```typescript
// app.module.ts
import { NgxFeatureFlagsTogglyModule } from '@ops-ai/ngx-feature-flags-toggly';

@NgModule({
  imports: [
    NgxFeatureFlagsTogglyModule.forRoot({
      appKey: 'your-app-key',
      environment: 'Production'
    })
  ]
})
export class AppModule {}
```

## Usage

### Structural Directive

```typescript
import { Component } from '@angular/core';
import { FeatureFlagDirective } from '@ops-ai/ngx-feature-flags-toggly';

@Component({
  standalone: true,
  imports: [FeatureFlagDirective],
  template: `
    <div *featureFlag="'premium-feature'">
      Premium content here
    </div>
  `
})
export class MyComponent {}
```

### Feature Component

```typescript
import { Component } from '@angular/core';
import { FeatureComponent, FeatureTemplateDirective } from '@ops-ai/ngx-feature-flags-toggly';

@Component({
  standalone: true,
  imports: [FeatureComponent, FeatureTemplateDirective],
  template: `
    <feature featureKey="new-dashboard">
      <ng-template featureTemplate>
        <app-new-dashboard />
      </ng-template>
    </feature>
  `
})
export class MyComponent {}
```

### Multiple Features

```html
<!-- Show when ALL features are enabled -->
<div *featureFlag="['feature-a', 'feature-b']">
  Both features enabled
</div>

<!-- Show when ANY feature is enabled -->
<div *featureFlag="['feature-a', 'feature-b']; requirement: 'any'">
  At least one feature enabled
</div>

<!-- Show when feature is DISABLED -->
<div *featureFlag="'old-feature'; negate: true">
  Old feature is disabled
</div>
```

### Route Guard

```typescript
// Functional guard (Angular 15+, recommended)
import { featureFlagGuard } from '@ops-ai/ngx-feature-flags-toggly';

const routes: Routes = [
  {
    path: 'premium',
    component: PremiumComponent,
    canActivate: [featureFlagGuard],
    data: {
      featureFlag: 'premium-feature',
      featureFlagRedirect: '/upgrade'
    }
  }
];

// Class-based guard (backward compatibility)
import { FeatureFlagGuard } from '@ops-ai/ngx-feature-flags-toggly';

const routes: Routes = [
  {
    path: 'premium',
    component: PremiumComponent,
    canActivate: [FeatureFlagGuard],
    data: {
      featureFlag: 'premium-feature',
      featureFlagRedirect: '/upgrade'
    }
  }
];
```

### Service

```typescript
import { Component, inject } from '@angular/core';
import { TogglyService } from '@ops-ai/ngx-feature-flags-toggly';

@Component({...})
export class MyComponent {
  private toggly = inject(TogglyService);

  async checkFeature() {
    const isEnabled = await this.toggly.isFeatureOn('my-feature');
    console.log('Feature enabled:', isEnabled);
  }
}
```

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `appKey` | string | Your Toggly application key |
| `environment` | string | Environment name (default: 'Production') |
| `identity` | string | User identity for personalized flags |
| `featureDefaults` | object | Default values when offline |
| `showFeatureDuringEvaluation` | boolean | Show content during flag evaluation |
| `baseURI` | string | Custom API base URL |
| `customDefinitionsUrl` | string | Custom definitions endpoint |

## Compatibility

| Angular | CLI / build | TypeScript | Node.js | Host |
| --- | --- | --- | --- | --- |
| 15.0.0 | 15.0.0 | 4.8.4 | 18.20.8 | Zone.js OnPush |
| 15.2.10 | 15.2.11 | 4.9.5 | 18.20.8 | Zone.js OnPush |
| 16.2.12 | 16.2.16 | 5.1.6 | 18.20.8 | Zone.js OnPush |
| 17.3.12 | 17.3.17 | 5.4.5 | 18.20.8 | Zone.js OnPush |
| 18.2.14 | 18.2.21 | 5.5.4 | 18.20.8 | Zone.js OnPush |
| 19.2.25 | 19.2.27 | 5.8.3 | 22.23.2 | Zone.js OnPush |
| 20.3.31 | 20.3.37 | 5.9.3 | 24.18.0 | Zone.js OnPush |
| 21.2.23 | 21.2.24 | 5.9.3 | 24.18.0 | zoneless OnPush |
| 22.1.6 | 22.1.8 | 6.0.3 | 24.18.0 | zoneless OnPush |

The peer minimum remains Angular 15.0.0. These exact packed fixtures verify
public types with `skipLibCheck: false`, production builds, browser rendering,
input changes, both route guards, local gates, WebSocket updates, context changes,
and shutdown. Angular 18 includes an SDK 2.8.1 locked-consumer upgrade.
See `host-fixtures/matrix.json` and its committed dependency locks.

`npm run build` / `npm run build-lib` package the library with Angular 15.0.0,
ng-packagr 15.0.3, TypeScript 4.8.4, and Node 18.20.8 in the isolated `packaging/`
toolchain. This preserves the minimum Angular declaration ABI. The main workspace
retains Angular 22 for source tests. Do not publish output from a direct `ng build`
using the current test compiler.

Run `npm run test:hosts` after building. Each host selects its exact Node runtime
and npm 10.8.2, installs its committed lock, upgrades to the packed SDK, and launches
Chromium. Install Chromium with `npx playwright install chromium`, or set `CHROME_BIN`.
`TOGGLY_HOST=angular-22` selects one host. `TOGGLY_SIGNED_DEFS_TARBALL` supplies an
explicit local signer artifact for integration testing only; ordinary resolution
must also pass before release. The shipped signer dependency requires `^1.2.6`.

### Zoneless applications

Angular 21–22 applications using `provideZonelessChangeDetection()` support OnPush
hosts. Feature components and directives notify Angular after asynchronous
refreshes and device-local gate changes. Older applications may retain Zone.js.
Default browser builds need no Node crypto external.

Choose the Node and TypeScript versions required by your Angular generation:
[Angular version compatibility](https://angular.dev/reference/versions).
Older Angular versions are retained compatibility targets; upstream security
support follows Angular's own lifecycle.

## Device-local post-filter gates

Gate bundles of flags behind device-local master switches while rollouts stay on the worker. See **[Post-filter gates](https://docs.toggly.io/sdks/client-side/post-filter)**.

```typescript
TogglyModule.forRoot({
  appKey: 'your-app-key',
  localGates: [{
    id: 'apiRedesign',
    flagKeys: ['ApiV2Checkout'],
    isEnabled: () => apiRedesignEnabled,
  }],
});

// OFF — instant
apiRedesignEnabled = false;
this.toggly.notifyLocalGatesChanged();

// ON — reload, then notify (FeatureFlagDirective subscribes automatically)
apiRedesignEnabled = true;
await this.toggly.refresh();
this.toggly.notifyLocalGatesChanged();
```

## Extensibility with Hooks

Toggly provides a powerful hooks system that allows you to extend SDK functionality by hooking into feature flag lifecycle events. This is perfect for integrating with analytics, monitoring tools, or implementing custom behaviors.

### What are Hooks?

Hooks let you execute custom code at specific points in the feature flag evaluation lifecycle:

- **beforeEvaluation**: Called before a feature flag is evaluated
- **afterEvaluation**: Called after a feature flag is evaluated (with the result)
- **beforeIdentify**: Called before user identity is set or cleared
- **afterIdentify**: Called after user identity is set or cleared
- **afterRefresh**: Called after feature definitions are refreshed from Toggly

### Creating a Hook

A hook is an object that implements the `Hook` interface from `@ops-ai/toggly-hooks-types`:

```typescript
import { Hook } from '@ops-ai/toggly-hooks-types';

const myAnalyticsHook: Hook = {
  getMetadata: () => ({
    name: 'MyAnalyticsHook',
    version: '1.0.0'
  }),
  
  afterEvaluation: async (data) => {
    // Send to analytics
    this.analytics.track('Feature Flag Evaluated', {
      feature: data.featureKey,
      enabled: data.result
    });
  },
  
  afterIdentify: async (data) => {
    // Update analytics user context
    this.analytics.identify(data.userId, data.context);
  }
};
```

### Registering Hooks

You can register hooks in two ways:

**1. During module configuration:**

```typescript
import { NgModule } from '@angular/core';
import { TogglyModule } from '@ops-ai/ngx-feature-flags-toggly';
import { myAnalyticsHook } from './hooks/analytics.hook';

@NgModule({
  imports: [
    TogglyModule.forRoot({
      appKey: 'your-app-key',
      environment: 'your-environment-name',
      hooks: [myAnalyticsHook]
    })
  ]
})
export class AppModule { }
```

**2. At runtime using the service:**

```typescript
import { Component, OnInit, OnDestroy } from '@angular/core';
import { TogglyService } from '@ops-ai/ngx-feature-flags-toggly';
import { Hook } from '@ops-ai/toggly-hooks-types';

@Component({
  selector: 'app-my-component',
  template: '...'
})
export class MyComponent implements OnInit, OnDestroy {
  private analyticsHook: Hook;
  
  constructor(private togglyService: TogglyService) {
    this.analyticsHook = {
      getMetadata: () => ({ name: 'Analytics', version: '1.0.0' }),
      afterEvaluation: async (data) => {
        // Your analytics logic
      }
    };
  }
  
  ngOnInit(): void {
    this.togglyService.addHook(this.analyticsHook);
  }
  
  ngOnDestroy(): void {
    this.togglyService.removeHook(this.analyticsHook);
  }
}
```

### Hook Execution Order

When multiple hooks are registered:
- **before hooks** execute in FIFO order (first registered, first executed)
- **after hooks** execute in LIFO order (last registered, first executed)

This creates a "wrap" pattern where the first hook to start is the last to finish.

### Error Isolation

Hooks are designed to be safe:
- If a hook throws an error, it won't affect feature flag evaluation
- Other hooks will continue to execute
- Errors are logged but don't propagate to your application code

### Performance

Hooks are optimized for minimal performance impact:
- Hooks execute asynchronously without blocking evaluation
- Hook execution is extremely fast (typically < 1ms per hook)
- Multiple hooks can be registered without significant overhead

### Common Use Cases

**Analytics Integration:**
```typescript
import { Hook } from '@ops-ai/toggly-hooks-types';

export const clarityHook: Hook = {
  getMetadata: () => ({ name: 'Microsoft Clarity', version: '1.0.0' }),
  afterEvaluation: async (data) => {
    if (typeof (window as any).clarity !== 'undefined') {
      (window as any).clarity('event', `FeatureFlag:${data.featureKey}`);
    }
  }
};
```

**Debug Logging (Development Only):**
```typescript
import { Hook } from '@ops-ai/toggly-hooks-types';
import { environment } from '../environments/environment';

export const debugHook: Hook = {
  getMetadata: () => ({ name: 'DebugLogger', version: '1.0.0' }),
  afterEvaluation: async (data) => {
    if (!environment.production) {
      console.debug('[Toggly]', data.featureKey, '=', data.result);
    }
  }
};
```

**Angular Service Integration:**
```typescript
import { Injectable } from '@angular/core';
import { TogglyService } from '@ops-ai/ngx-feature-flags-toggly';
import { Hook } from '@ops-ai/toggly-hooks-types';
import { AnalyticsService } from './analytics.service';

@Injectable({ providedIn: 'root' })
export class FeatureFlagAnalyticsService {
  private hook: Hook;
  
  constructor(
    private togglyService: TogglyService,
    private analytics: AnalyticsService
  ) {
    this.hook = {
      getMetadata: () => ({ name: 'AnalyticsHook', version: '1.0.0' }),
      afterEvaluation: async (data) => {
        this.analytics.trackFeatureFlag(data.featureKey, data.result);
      }
    };
  }
  
  enable(): void {
    this.togglyService.addHook(this.hook);
  }
  
  disable(): void {
    this.togglyService.removeHook(this.hook);
  }
}
```

## Entity context

Use `*featureFlag` and `TogglyService.isFeatureOn` with a **per-row entity** and optional `contextKind`. User identity remains on `setContext()`. See [Angular entity context](https://docs.toggly.io/sdks/javascript/angular#entity-context).

```html
<div *featureFlag="'ExpressCheckout'; context: order; contextKind: 'Order'">
  Express checkout available
</div>
```

Also on the `<feature>` component:

```html
<feature featureKey="ExpressCheckout" [context]="order" contextKind="Order">
  <ng-template featureTemplate>
    <app-checkout />
  </ng-template>
</feature>
```



## License

MIT
