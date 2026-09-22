/**
 * React integration for Toggly in Astro
 */

export { Feature, useFeatureFlag, useFeatureGate, useVariant } from './Feature.js';
export type { FeatureProps } from './Feature.js';



export {recordUsage, recordView, incrementCounter, setGauge, flushTelemetry} from '../../client/store.js';
