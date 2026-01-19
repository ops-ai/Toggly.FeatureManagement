# @ops-ai/ngx-feature-flags-toggly

Angular SDK for [Toggly](https://toggly.io) feature flags. Supports Angular 15-19+.

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

| Angular Version | Support |
|-----------------|---------|
| 15.x | ✅ Full |
| 16.x | ✅ Full |
| 17.x | ✅ Full |
| 18.x | ✅ Full |
| 19.x | ✅ Full |

## License

MIT
