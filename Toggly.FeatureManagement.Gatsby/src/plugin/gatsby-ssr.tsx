/**
 * Gatsby SSR APIs
 * 
 * Server-side rendering hooks for Toggly plugin
 */

import React from 'react';
import type { GatsbySSR } from 'gatsby';
import type { TogglyPluginOptions } from '../types/index.js';
import { TogglyProvider } from '../components/TogglyProvider.js';

/**
 * Wrap root element with TogglyProvider
 * 
 * This ensures the Toggly client is initialized on both server and client
 */
export const wrapRootElement: GatsbySSR['wrapRootElement'] = (
  { element },
  pluginOptions
) => {
  const options = pluginOptions as unknown as TogglyPluginOptions;

  return <TogglyProvider config={options}>{element}</TogglyProvider>;
};

/**
 * Optional: Inject initial flags into HTML head
 * 
 * This is only used if you want to hydrate with server-fetched flags.
 * By default, flags are fetched client-side after hydration.
 */
// export const onRenderBody: GatsbySSR['onRenderBody'] = (
//   { setHeadComponents },
//   pluginOptions
// ) => {
//   const options = pluginOptions as TogglyPluginOptions;
//
//   // Only inject if explicitly configured
//   if (options.injectFlags) {
//     // Note: This would require fetching flags server-side during SSR
//     // For now, we skip this and rely on client-side fetching
//     setHeadComponents([
//       <script
//         key="toggly-flags"
//         dangerouslySetInnerHTML={{
//           __html: `window.__TOGGLY_FLAGS__ = ${JSON.stringify({})};`,
//         }}
//       />,
//     ]);
//   }
// };
