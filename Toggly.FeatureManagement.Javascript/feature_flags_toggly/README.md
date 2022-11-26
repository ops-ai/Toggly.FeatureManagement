Lightweight package that provides feature flags support for javascript applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

Simply embed our latest bundle from the following CDN.

```html
<script src="https://cdn.jsdelivr.net/npm/@ops-ai/feature-flags-toggly@1.0.2/dist/feature-flags-toggly.bundle.js"></script>
```

Alternatively, you can use NPM to manually build the bundled *.js file.

```shell
$ npm install @ops-ai/feature-flags-toggly
$ cd node_modules/@ops-ai/feature-flags-toggly && npm run build
```

And then grab the generated bundled file from the ./dist directory.

## Basic Usage (with Toggly.io)

Initialize Toggly by running the Toggly.init method and by providing your App Key from your [Toggly application page](https://app.toggly.io)

```js
var featureFlagsDefaults = {
  "SignUpButton": true,
  "DemoScreenshot": true
};

Toggly.init({
  appKey: '<YOUR_APP_KEY>',
  environment: '<YOUR_APP_ENVIRONMENT>'
})
  .then(function () {
    // Now you can check if a feature (or more) is Enabled/Disabled
    
    if (Toggly.isFeatureOn('SignUpButton')) {
      // SignUpButton is ON
    }

    if (Toggly.isFeatureOff('DemoScreenshot')) {
      // DemoScreenshot is OFF
    }
});
```

You can also check multiple feature keys and make use of the *requirement* (FeatureRequirement.all, FeatureRequirement.any) and *negate* (bool) options.

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.all)) {
  // ALL the provided feature keys are TRUE
}
```

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.any)) {
  // AT LEAST ONE the provided feature keys is TRUE
}
```

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.all, true)) {
  // ALL the provided feature keys are FALSE
}
```

Lastly, you can set how often you would like to synchronize (re-fetch from Toggly) the feature flags values by setting the *.featureFlagsRefreshInterval when runnint *.init.

```js
Toggly.init({
  appKey: '<YOUR_APP_KEY>',
  environment: '<YOUR_APP_ENVIRONMENT>',
  featureFlagsRefreshInterval: 3 * 60 * 1000
})
  .then(function () {
    // Now you can check if a feature (or more) is Enabled/Disabled ...
  });
```

## Basic Usage (without Toggly.io)

Initialize Toggly by running the Toggly.init method

```js
var featureFlagsDefaults = {
  "SignUpButton": true,
  "DemoScreenshot": true
};

Toggly.init({ flagDefaults: featureFlagsDefaults }).then(function () {

  // Now you can check if a feature (or more) is Enabled/Disabled
  
  if (Toggly.isFeatureOn('SignUpButton')) {
    // SignUpButton is ON
  }

  if (Toggly.isFeatureOff('DemoScreenshot')) {
    // DemoScreenshot is OFF
  }
});
```

You can also check multiple feature keys and make use of the *requirement* (FeatureRequirement.all, FeatureRequirement.any) and *negate* (bool) options.

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.all)) {
  // ALL the provided feature keys are TRUE
}
```

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.any)) {
  // AT LEAST ONE the provided feature keys is TRUE
}
```

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.all, true)) {
  // ALL the provided feature keys are FALSE
}
```

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).
