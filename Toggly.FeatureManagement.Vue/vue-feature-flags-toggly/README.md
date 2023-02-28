Lightweight package that provides feature flags support for Vue.js applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

Simply install use NPM to install this package.

```shell
$ npm i -s @ops-ai/vue-feature-flags-toggly
```

## Basic Usage (with Toggly.io)

Import the Toggly plugin in your main file.

```js
import { toggly } from "@ops-ai/vue-feature-flags-toggly";
```

Install the toggly plugin while providing your App Key & Environment name from your [Toggly application page](https://app.toggly.io). This will register the Feature component & $toggly service globally.

```js
app.use(toggly, {
  appKey: "your-app-key", // You can find this in app.toggly.io
  environment: "your-environment-name", // You can find this in app.toggly.io
});
```

Using this package with [Toggly](https://toggly.io) allows you to define custom feature rollouts.

Custom rollouts offers the ability to show features only to certain groups of users based on various custom rules which you can define in [Toggly](https://app.toggly.io).

In case you want to support custom feature rollouts, remember to provide an unique identity string for each user to make sure they get the same feature values on future visits.

```js
app.use(toggly, {
  appKey: "your-app-key", // You can find this in app.toggly.io
  environment: "your-environment-name", // You can find this in app.toggly.io
  identity: "unique-user-identifier", // Use this in case you want to support custom feature rollouts
});
```

Now you can start using the Feature component anywhere in your application.

```html
<Feature feature-key="firstFeature">
  <p>This feature can be turned on or off.</p>
</Feature>
```

You can also check multiple feature keys and make use of the *requirement* (all/any) and *negate* (bool) options (requirement is set to "all" by default).

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']">
  <p>ALL the provided feature keys are TRUE.</p>
</Feature>
```

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']" requirement="any">
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</Feature>
```

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']" requirement="all" :negate="true">
  <p>NONE of the provided feature keys is TRUE.</p>
</Feature>
```

Lastly, you can use the *$toggly* service to check if a feature is ON or OFF programmatically, by simply injecting it in any component.

```js
export default {
  inject: ['$toggly'],
  ...
}
```

```js
await this.$toggly.isFeatureOn('firstFeature')
```

```js
await this.$toggly.isFeatureOff('secondFeature')
```

And even evaluate a feature gate (with requirement & negate support).

```js
await this.$toggly.evaluateFeatureGate(['firstFeature', 'secondFeature'], 'any', true)
```

## Basic Usage (without Toggly.io)

Import the Toggly plugin in your main file.

```js
import { toggly } from "@ops-ai/vue-feature-flags-toggly";
```

Install the toggly plugin while providing your default feature flags. This will register the Feature component & $toggly service globally.

```js
var featureDefaults = {
  firstFeature: true,
  secondFeature: false,
}

app.use(toggly, {
  featureDefaults: featureDefaults,
});
```

Now you can start using the Feature component anywhere in your application.

```html
<Feature feature-key="firstFeature">
  <p>This feature can be turned on or off.</p>
</Feature>
```

You can also check multiple feature keys and make use of the *requirement* (all/any) and *negate* (bool) options (requirement is set to "all" by default).

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']">
  <p>ALL the provided feature keys are TRUE.</p>
</Feature>
```

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']" requirement="any">
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</Feature>
```

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']" requirement="all" :negate="true">
  <p>NONE of the provided feature keys is TRUE.</p>
</Feature>
```

Lastly, you can use the *$toggly* service to check if a feature is ON or OFF programmatically, by simply injecting it in any component.

```js
export default {
  inject: ['$toggly'],
  ...
}
```

```js
await this.$toggly.isFeatureOn('firstFeature')
```

```js
await this.$toggly.isFeatureOff('secondFeature')
```

And even evaluate a feature gate (with requirement & negate support).

```js
await this.$toggly.evaluateFeatureGate('firstFeature', 'secondFeature'], 'any', true)
```

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).