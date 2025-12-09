/**
 * Client-side setup for Toggly in Docusaurus
 *
 * This module runs in the browser and initializes the Toggly client.
 * The config is available via window.__TOGGLY_CONFIG__ injected by the plugin.
 *
 * Note: Users need to wrap their app with TogglyProvider manually,
 * or use the swizzle feature to inject it into the root layout.
 */

// This module is imported globally by Docusaurus
// It can be used to set up global state or side effects

if (typeof window !== 'undefined') {
  // Config is already available via window.__TOGGLY_CONFIG__ from injectHtmlTags
  // Users can access it in their components via:
  // const config = (window as any).__TOGGLY_CONFIG__;
}
