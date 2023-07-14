Lightweight package that provides feature flags support for Angular applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

Simply use NPM to install this package.

```shell
$ npm i -s @ops-ai/ngx-feature-flags-toggly
```

## Basic Usage (with Toggly.io)

Import the Toggly library in your main file.

```js
import { NgxFeatureFlagsTogglyModule } from '@ops-ai/ngx-feature-flags-toggly'
```

Import the Toggly library while providing your App Key & Environment name from your [Toggly application page](https://app.toggly.io).

```js
@NgModule({
  declarations: [AppComponent],
  imports: [
    ...
    NgxFeatureFlagsTogglyModule.forRoot({
      appKey: 'your-app-key', // You can find this in Toggly.io
      environment: 'your-environment-name', // You can find this in Toggly.io
    }),
  ],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

Using this package with [Toggly](https://toggly.io) allows you to define custom feature rollouts.

Custom rollouts offers the ability to show features only to certain groups of users based on various custom rules which you can define in [Toggly](https://app.toggly.io).

In case you want to support custom feature rollouts, remember to provide an unique identity string for each user to make sure they get the same feature values on future visits.

```js
NgxFeatureFlagsTogglyModule.forRoot({
  appKey: 'your-app-key', // You can find this in Toggly.io
  environment: 'your-environment-name', // You can find this in Toggly.io
  identity: 'unique-user-identifier', // Use this in case you want to support custom feature rollouts
}),
```

Now you can start using the Feature Flag directive, Feature component & Feature Flag Guard anywhere in your application.

*Feature Flag Directive*

```html
<div *featureFlag="'firstFeature'">
  <p>This feature can be turned on or off.</p>
</div>
```

You can also check multiple feature keys and make use of the **requirement** (all/any) and **negate** (bool) parameters (requirement is set to "all" by default).

```html
<div *featureFlag="['firstFeature', 'secondFeature']">
  <p>ALL the provided feature keys are TRUE.</p>
</div>
```

```html
<div *featureFlag="['firstFeature', 'secondFeature']" featureFlagRequirement="any">
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</div>
```

```html
<div *featureFlag="['firstFeature', 'secondFeature']" featureFlagRequirement="all" [featureFlagNegate]="true">
  <p>NONE of the provided feature keys is TRUE.</p>
</div>
```

*Feature Component*

```html
<feature featureKey="firstFeature">
  <ng-template featureTemplate>
    <p>This feature can be turned on or off.</p>
  </ng-template>
</feature>
```

You can also check multiple feature keys and make use of the **requirement** (all/any) and **negate** (bool) options (requirement is set to "all" by default).

```html
<feature [feature-keys]="['firstFeature', 'secondFeature']">
  <ng-template featureTemplate>
    <p>ALL the provided feature keys are TRUE.</p>
  </ng-template>
</feature>
```

```html
<feature [feature-keys]="['firstFeature', 'secondFeature']" requirement="any">
  <ng-template featureTemplate>
    <p>AT LEAST ONE the provided feature keys is TRUE.</p>
  </ng-template>
</feature>
```

```html
<feature [feature-keys]="['firstFeature', 'secondFeature']" requirement="all" [negate]="true">
  <ng-template featureTemplate>
    <p>NONE of the provided feature keys is TRUE.</p>
  </ng-template>
</feature>
```

*Feature Flag Guard*

```js
@NgModule({
  imports: [
    RouterModule.forRoot([
      {
        path: 'experimental-route',
        loadChildren: () => import('/path/to/module').then((module) => module.ExperimentalModuleName),
        canActivate: [FeatureFlagGuard],
        data: {
          featureFlag: 'firstFeature',
          featureFlagRedirect: '/path/for/redirect', // URL Path to redirect in case feature flag should not be displayed
        },
      }
    ])
  ]
})
```

You can also check multiple feature keys and make use of the **featureFlagRequirement** (all/any) and **featureFlagNegate** (bool) options (requirement is set to "all" by default).

```js
@NgModule({
  imports: [
    RouterModule.forRoot([
      {
        path: 'experimental-route',
        loadChildren: () => import('/path/to/module').then((module) => module.ExperimentalModuleName),
        canActivate: [FeatureFlagGuard],
        data: {
          featureFlag: 'firstFeature',
          featureFlagRequirement: 'any',
          featureFlagNegate: true,
          featureFlagRedirect: '/path/for/redirect',
        },
      }
    ])
  ]
})
```

Lastly, you can use the **TogglyService** to check if a feature is ON or OFF programmatically, by simply injecting it in any component.

```js
@Component({
  selector: 'app-random',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class RandomComponent {
  constructor(private toggly: TogglyService) { }
}
```

```js
this.toggly
  .isFeatureOn('firstFeature')
  .then(isEnabled => { /* Checks if feature is enabled */ })
```

```js
this.toggly
  .isFeatureOff('firstFeature')
  .then(isDisabled => { /* Checks if feature is disabled */ })
```

And even evaluate a feature gate (with requirement & negate support).

```js
this.toggly
  .evaluateFeatureGate(['firstFeature', 'secondFeature'], 'any', false)
  .then(isDisabled => { /* Checks if at least one of the provided features is enabled */ })
```

## Basic Usage (without Toggly.io)

Import the Toggly library in your main file.

```js
import { NgxFeatureFlagsTogglyModule } from '@ops-ai/ngx-feature-flags-toggly'
```

Import the Toggly library while providing your default feature flags.

```js
@NgModule({
  declarations: [AppComponent],
  imports: [
    ...
    NgxFeatureFlagsTogglyModule.forRoot({
      featureDefaults: {
        firstFeature: true,
        secondFeature: false,
      }
    }),
  ],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

Now you can start using the Feature Flag directive, Feature component & Feature Flag Guard anywhere in your application.

*Feature Flag Directive*

```html
<div *featureFlag="'firstFeature'">
  <p>This feature can be turned on or off.</p>
</div>
```

You can also check multiple feature keys and make use of the **requirement** (all/any) and **negate** (bool) parameters (requirement is set to "all" by default).

```html
<div *featureFlag="['firstFeature', 'secondFeature']">
  <p>ALL the provided feature keys are TRUE.</p>
</div>
```

```html
<div *featureFlag="['firstFeature', 'secondFeature']" featureFlagRequirement="any">
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</div>
```

```html
<div *featureFlag="['firstFeature', 'secondFeature']" featureFlagRequirement="all" [featureFlagNegate]="true">
  <p>NONE of the provided feature keys is TRUE.</p>
</div>
```

*Feature Component*

```html
<feature featureKey="firstFeature">
  <ng-template featureTemplate>
    <p>This feature can be turned on or off.</p>
  </ng-template>
</feature>
```

You can also check multiple feature keys and make use of the **requirement** (all/any) and **negate** (bool) options (requirement is set to "all" by default).

```html
<feature [feature-keys]="['firstFeature', 'secondFeature']">
  <ng-template featureTemplate>
    <p>ALL the provided feature keys are TRUE.</p>
  </ng-template>
</feature>
```

```html
<feature [feature-keys]="['firstFeature', 'secondFeature']" requirement="any">
  <ng-template featureTemplate>
    <p>AT LEAST ONE the provided feature keys is TRUE.</p>
  </ng-template>
</feature>
```

```html
<feature [feature-keys]="['firstFeature', 'secondFeature']" requirement="all" [negate]="true">
  <ng-template featureTemplate>
    <p>NONE of the provided feature keys is TRUE.</p>
  </ng-template>
</feature>
```

*Feature Flag Guard*

```js
@NgModule({
  imports: [
    RouterModule.forRoot([
      {
        path: 'experimental-route',
        loadChildren: () => import('/path/to/module').then((module) => module.ExperimentalModuleName),
        canActivate: [FeatureFlagGuard],
        data: {
          featureFlag: 'firstFeature',
          featureFlagRedirect: '/path/for/redirect', // URL Path to redirect in case feature flag should not be displayed
        },
      }
    ])
  ]
})
```

You can also check multiple feature keys and make use of the **featureFlagRequirement** (all/any) and **featureFlagNegate** (bool) options (requirement is set to "all" by default).

```js
@NgModule({
  imports: [
    RouterModule.forRoot([
      {
        path: 'experimental-route',
        loadChildren: () => import('/path/to/module').then((module) => module.ExperimentalModuleName),
        canActivate: [FeatureFlagGuard],
        data: {
          featureFlag: 'firstFeature',
          featureFlagRequirement: 'any',
          featureFlagNegate: true,
          featureFlagRedirect: '/path/for/redirect',
        },
      }
    ])
  ]
})
```

Lastly, you can use the **TogglyService** to check if a feature is ON or OFF programmatically, by simply injecting it in any component.

```js
@Component({
  selector: 'app-random',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class RandomComponent {
  constructor(private toggly: TogglyService) { }
}
```

```js
this.toggly
  .isFeatureOn('firstFeature')
  .then(isEnabled => { /* Checks if feature is enabled */ })
```

```js
this.toggly
  .isFeatureOff('firstFeature')
  .then(isDisabled => { /* Checks if feature is disabled */ })
```

And even evaluate a feature gate (with requirement & negate support).

```js
this.toggly
  .evaluateFeatureGate(['firstFeature', 'secondFeature'], 'any', false)
  .then(isDisabled => { /* Checks if at least one of the provided features is enabled */ })
```

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).
