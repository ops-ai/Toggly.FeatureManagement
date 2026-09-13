const { pathToFileURL } = require('node:url')

// Unit tests run through Jest's CommonJS transform. Rollup replaces this seam
// in published output; this setup gives source tests the matching file URL.
globalThis.__TOGGLY_MODULE_URL__ = pathToFileURL(__filename).href
