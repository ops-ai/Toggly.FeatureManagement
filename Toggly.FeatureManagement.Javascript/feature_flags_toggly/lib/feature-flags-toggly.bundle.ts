// The browser bundle installs window.Toggly; it does not export a runtime module.
export type { TogglyConfig } from './models/toggly-config';

declare global {
  interface Window {
    Toggly: typeof import('./toggly').Toggly;
  }
}
