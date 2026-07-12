# Toggly HTML / CSS Feature Flags

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

Show or hide DOM elements with feature flags using Toggly’s client CSS definitions — no SDK required.

## Get started

1. Create a free app at [toggly.io](https://toggly.io).
2. Link the generated definitions stylesheet for your app:

```html
<link
  rel="stylesheet"
  href="https://client.toggly.io/YOUR_APP_KEY/defs.css"
/>
```

3. Mark elements with `feature-key` (and optional `negate` / `feature-condition`):

```html
<div feature-key="MyFeature">Visible when MyFeature is on</div>
<div feature-key="MyFeature" negate="true">Visible when MyFeature is off</div>
<div feature-key="FeatureA FeatureB" feature-condition="any">Any flag on</div>
<div feature-key="FeatureA FeatureB" feature-condition="all">All flags on</div>
```

## Example

See [`Demo.Css/index.html`](Demo.Css/index.html) for a complete demo page.

## Documentation & resources

- **Product docs**: [docs.toggly.io](https://docs.toggly.io)
- **SDK catalog**: [`../README.md`](../README.md)

## Contributing

Please open an issue first, then follow the monorepo [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Security

Report vulnerabilities privately via [GitHub Private Vulnerability Reporting](https://github.com/ops-ai/Toggly.FeatureManagement/security/advisories/new). See [`SECURITY.md`](../SECURITY.md).

## License

[MIT](LICENSE)
