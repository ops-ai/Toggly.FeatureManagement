
## 1.1.9

2025-03-10

### Reliability
- Added app lifecycle state monitoring to only refresh features when app is in the foreground

### Breaking Changes
- None


## 1.1.8

2025-02-19

### Reliability
- Improved offline support by properly handling cached feature flags
- Added fallback to default values when cache is invalid or missing
- Added better error handling for signature verification
- Added debug logging for troubleshooting

### Breaking Changes
- None

## 1.1.7

2025-02-15

* Fixed bug in check when identity changes.

## 1.1.6

2025-02-15

* Added logic to clear cached feature flags if identity changes.

## 1.1.5

2025-02-15

* Fixed clearing etag as well if deserialization fails or verification fails.

## 1.1.4

2025-02-14

* Clear cached feature flags if cache deserialization or verification fails.

## 1.1.3

2025-02-12

* Return cached feature flags if the API call fails

## 1.1.2

2025-02-07

* Added timestamp verification for signed definitions.
* Added certificate whitelist for signed definitions.
* Added benchmarks for API evaluation.
* Performance improvements.

## 1.1.1

2025-02-05

* Updated documentation to include key rotation information.

## 1.1.0

2025-02-05

* Added support for offline validation of signed definitions.

## 1.0.9

2025-01-25

* Added support for signed definitions.

## 1.0.8

2025-01-23

* Added support for multiple children in Feature widget.

## 1.0.5

2023-06-01

* Better dependencies support.

## 1.0.4

2023-06-01

* Better dependencies support.

## 1.0.3

2022-11-22

* Added static "dispose" method to clear timers & cancel streams.

## 1.0.2

2022-11-22

* More doc comments

## 1.0.1

2022-11-22

* Doc comments
* Fixed Lint issues
* Cleaned unused methods *.featureGateFuture and replaced with *.evaluateFeatureGate

## 1.0.0

2022-11-13

* Toggly & Feature classes
* Allow usage without Toggly service (by providing flagDefaults)
* Allow usage with Toggly service (by providing your App Key & Environment name)
* Feature Gate unit tests
* Documentation
* License



