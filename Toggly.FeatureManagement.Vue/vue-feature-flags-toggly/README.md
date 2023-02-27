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

Import the Toggly service inside your main.js file.

```js
import toggly from './toggly'
```

Declare $toggly as a global property & initialize it by running the $toggly.init method and by providing your App Key from your [Toggly application page](https://app.toggly.io)

```js
app.config.globalProperties.$toggly = toggly
app.config.globalProperties.$toggly.init(
  'your-app-key', // You can find this in Toggly.io
  'your-environment-name', // You can find this in Toggly.io
  'unique-user-identifier' // Use this in case you want to support custom feature rollouts
)
```

Now you can start using the Feature component.

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

Lastly, you can use *$toggly* to check if a feature is ON or OFF programmatically.

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

## Basic Usage (without Toggly.io)

Import the Toggly service inside your main.js file.

```js
import toggly from './toggly'
```

Declare $toggly as a global property & initialize it by running the $toggly.init method and by providing your App Key from your [Toggly application page](https://app.toggly.io)

```js

var featureFlagDefaults = {
  firstFeature: true,
  secondFeature: false,
}

app.config.globalProperties.$toggly = toggly
app.config.globalProperties.$toggly.init(
  null, // No need for an application key
  null, // No need for an evironment name
  null, // Custom rollouts are not supported without Toggly.io
  featureFlagDefaults
)
```

Now you can start using the Feature component.

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

Lastly, you can use *$toggly* to check if a feature is ON or OFF programmatically.

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