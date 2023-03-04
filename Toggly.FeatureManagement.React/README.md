Lightweight package that provides feature flags support for React applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

Simply install use NPM to install this package.

```shell
$ npm i -s @ops-ai/react-feature-flags-toggly
```

## Basic Usage (with Toggly.io)

Import **createTogglyProvider** in your index file.

```js
import { createTogglyProvider } from '@ops-ai/react-feature-flags-toggly'
```

Create a TogglyProvider with your App Key & Environment name from your [Toggly application page](https://app.toggly.io).

```js
 const TogglyProvider = await createTogglyProvider({
    appKey: 'your-app-key', // You can find this in Toggly.io
    environment: 'your-environment-name', // You can find this in Toggly.io
  })
```

Wrap your App component with the newly created TogglyProvider.

```js
  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement,
  )
  root.render(
    <React.StrictMode>
      <TogglyProvider>
        <App />
      </TogglyProvider>
    </React.StrictMode>,
  )
```

Using this package with [Toggly](https://toggly.io) allows you to define custom feature rollouts.

Custom rollouts offers the ability to show features only to certain groups of users based on various custom rules which you can define in [Toggly](https://app.toggly.io).

In case you want to support custom feature rollouts, remember to provide an unique identity string for each user to make sure they get the same feature values on future visits.

```js
  const TogglyProvider = await createTogglyProvider({
    appKey: 'your-app-key', // You can find this in Toggly.io
    environment: 'your-environment-name', // You can find this in Toggly.io
    identity: 'unique-user-identifier', // Use this in case you want to support custom feature rollouts
  })
```

Now you can start using the Feature component anywhere in your application by importing the Feature component.

```js
import { Feature } from '@ops-ai/react-feature-flags-toggly'
```

```html
<Feature featureKey={'firstFeature'}>
  <p>This feature can be turned on or off.</p>
</Feature>
```

You can also check multiple feature keys and make use of the *requirement* (all/any) and *negate* (bool) options (requirement is set to "all" by default).

```html
<Feature featureKeys={['firstFeature', 'secondFeature']}>
  <p>ALL the provided feature keys are TRUE.</p>
</Feature>
```

```html
<Feature featureKeys={['firstFeature', 'secondFeature']} requirement={'any'}>
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</Feature>
```

```html
<Feature featureKeys={['firstFeature', 'secondFeature']}  negate={false}>
  <p>NONE of the provided feature keys is TRUE.</p>
</Feature>
```

## Basic Usage (without Toggly.io)

Import **createTogglyProvider** in your index file.

```js
import { createTogglyProvider } from '@ops-ai/react-feature-flags-toggly'
```

Create a TogglyProvider and provide your feature defaults.

```js
  const featureDefaults = {
    mainDescription: true,
    documentationItem: true,
    toolingItem: true,
  }

 const TogglyProvider = await createTogglyProvider({
    featureDefaults: featureDefaults
  })
```

Wrap your App component with the newly created TogglyProvider.

```js
  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement,
  )
  root.render(
    <React.StrictMode>
      <TogglyProvider>
        <App />
      </TogglyProvider>
    </React.StrictMode>,
  )
```

Now you can start using the Feature component anywhere in your application by importing the Feature component.

```js
import { Feature } from '@ops-ai/react-feature-flags-toggly'
```

```html
<Feature featureKey={'firstFeature'}>
  <p>This feature can be turned on or off.</p>
</Feature>
```

You can also check multiple feature keys and make use of the *requirement* (all/any) and *negate* (bool) options (requirement is set to "all" by default).

```html
<Feature featureKeys={['firstFeature', 'secondFeature']}>
  <p>ALL the provided feature keys are TRUE.</p>
</Feature>
```

```html
<Feature featureKeys={['firstFeature', 'secondFeature']} requirement={'any'}>
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</Feature>
```

```html
<Feature featureKeys={['firstFeature', 'secondFeature']}  negate={false}>
  <p>NONE of the provided feature keys is TRUE.</p>
</Feature>
```

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).