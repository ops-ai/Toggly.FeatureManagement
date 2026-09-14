# @ops-ai/nuxt-toggly-client

Client-side feature flag composables and components for Nuxt/Vue 3

## Install

```bash
npm install @ops-ai/nuxt-toggly-client
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).

## SSR and hydration

Nuxt module 1.2.0 supplies an isolated Vue provider per SSR request, then hydrates
its evaluated flags in the browser. `getTogglyClient()` is a browser convenience;
on the server, retain the instance returned by `createToggly()` or use the
provided `useToggly()` instance. Ordinary uninitialized gates keep their loading
behavior; a ready hydration snapshot can render boolean gates synchronously.
