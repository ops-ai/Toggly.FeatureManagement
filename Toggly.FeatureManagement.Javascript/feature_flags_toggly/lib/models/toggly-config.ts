export interface TogglyConfig {
  baseURI: string;
  reloadOnFeatureFlagValidation: boolean;
  connectTimeout: number;
  featureFlagsRefreshInterval: number;
  isDebug: boolean;

  appKey?: string;
  environment?: string;
}