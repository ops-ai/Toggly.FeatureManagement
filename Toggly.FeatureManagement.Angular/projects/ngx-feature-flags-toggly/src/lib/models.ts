export interface ITogglyOptions {
  baseURI?: string
  appKey?: string
  environment?: string
  identity?: string
  featureDefaults?: { [key: string]: boolean }
  showFeatureDuringEvaluation?: boolean
}

export interface ITogglyService {
  shouldShowFeatureDuringEvaluation: boolean
  evaluateFeatureGate: (
    featureKeys: string[],
    requirement: string,
    negate: boolean,
  ) => Promise<boolean>
  isFeatureOn: (featureKey: string) => Promise<boolean>
  isFeatureOff: (featureKey: string) => Promise<boolean>
}
