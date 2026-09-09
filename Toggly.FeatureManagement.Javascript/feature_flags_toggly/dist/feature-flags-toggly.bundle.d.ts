export type { TogglyConfig } from './models/toggly-config';
declare global {
    interface Window {
        Toggly: typeof import('./toggly').Toggly;
    }
}
