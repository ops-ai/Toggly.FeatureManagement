/**
 * Gatsby SSR API entry point
 * 
 * Re-exports the compiled plugin hooks from dist
 */

const plugin = require('./dist/plugin/gatsby-ssr.js');

module.exports = plugin;
