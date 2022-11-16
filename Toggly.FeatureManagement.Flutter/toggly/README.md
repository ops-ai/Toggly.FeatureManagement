Dart package that provides feature flags support for flutter applications allowing you to enable and disable features easily.

Can be used **WITH** or **WITHOUT** [Toggly.io](https://toggly.io).*

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

```
$ flutter pub add feature_flags_toggly
```

This will add a line like this to your package's pubspec.yaml (and run an implicit flutter pub get):

```yaml
dependencies:
  feature_flags_toggly: ^0.0.1
```

Alternatively, your editor might support flutter pub get. Check the docs for your editor to learn more.

Now in your Dart code, you can use:

```dart
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
```

## Basic Usage
###### With Toggly.io

Initialize Toggly by running the Toggly.init method and by providing your App Key from your [Toggly application page](https://app.toggly.io)

```dart
@override
void initState() {
  initToggly();
  super.initState();
}

void initToggly() async {
  await Toggly.init(
    appKey: '<your_app_key>',
    environment: '<your_app_environment>',
    flagDefaults: {
      "ExampleFeatureKey1": true,
      "ExampleFeatureKey2": false,
      "ExampleFeatureKey3": true,
    },
  );
}

Now simply wrap your widgets in **Feature** widgets and provide them with the **featureKeys** that best describe them.

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1'],
  child: const Text('This text will show if ExampleFeatureKey1 is FALSE'),
),
```

You can also use multiple feature keys for one Feature widget and make use of the **requirement** (FeatureRequirement.all, FeatureRequirement.any) and **negate** (bool) options.

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1', 'ExampleFeatureKey2'],
  requirement: FeatureRequirement.any,
  child: const Text('This text will show if ANY of the provided feature keys are TRUE'),
),
```

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1', 'ExampleFeatureKey2'],
  requirement: FeatureRequirement.all,
  child: const Text('This text will show if ALL the provided feature keys are TRUE'),
),
```

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1'],
  negate: true,
  child: const Text('This text will show if ExampleFeatureKey1 is FALSE'),
),
```

Lastly, you can also evaluate the value of a Feature gate by calling **evaluateFeatureGate** directly, using the same arguments as for the Feature widget.

```dart
await Toggly.evaluateFeatureGate(
  ["ExampleFeatureKey1", "ExampleFeatureKey2"],
  requirement: FeatureRequirement.all,
  negate: true,
);
```

## Basic Usage
###### Without Toggly.io

Initialize Toggly by running the Toggly.init method

```dart
@override
void initState() {
  initToggly();
  super.initState();
}

void initToggly() async {
  await Toggly.init(
    flagDefaults: {
      "ExampleFeatureKey1": true,
      "ExampleFeatureKey2": false,
      "ExampleFeatureKey3": true,
    },
  );
}
```

Now simply wrap your widgets in **Feature** widgets and provide them with the **featureKeys** that best describe them.

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1'],
  child: const Text('This text will show if ExampleFeatureKey1 is FALSE'),
),
```

You can also use multiple feature keys for one Feature widget and make use of the **requirement** (FeatureRequirement.all, FeatureRequirement.any) and **negate** (bool) options.

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1', 'ExampleFeatureKey2'],
  requirement: FeatureRequirement.any,
  child: const Text('This text will show if ANY of the provided feature keys are TRUE'),
),
```

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1', 'ExampleFeatureKey2'],
  requirement: FeatureRequirement.all,
  child: const Text('This text will show if ALL the provided feature keys are TRUE'),
),
```

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1'],
  negate: true,
  child: const Text('This text will show if ExampleFeatureKey1 is FALSE'),
),
```

Lastly, you can also evaluate the value of a Feature gate by calling **evaluateFeatureGate** directly, using the same arguments as for the Feature widget.

```dart
await Toggly.evaluateFeatureGate(
  ["ExampleFeatureKey1", "ExampleFeatureKey2"],
  requirement: FeatureRequirement.all,
  negate: true,
);
```

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).
