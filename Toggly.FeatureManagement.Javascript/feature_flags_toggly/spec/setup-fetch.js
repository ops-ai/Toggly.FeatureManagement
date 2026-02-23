// Polyfill fetch for jsdom test environment.
// jest-environment-jsdom does not include the Fetch API.
require('cross-fetch/polyfill');
