/**
 * Gatsby Node API entry point
 * 
 * Re-exports the compiled plugin hooks from dist
 */

const plugin = require('./dist/plugin/gatsby-node.js');

module.exports = plugin;
