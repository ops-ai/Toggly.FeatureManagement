export enum TogglyLoadFeatureFlagsResponse {
  fetched,
  cached,
  defaults,
  error,
}

export class TogglyInitResponse {
  status: TogglyLoadFeatureFlagsResponse;

  constructor(status: TogglyLoadFeatureFlagsResponse) {
    this.status = status;
  }
}
