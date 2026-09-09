export declare enum TogglyLoadFeatureFlagsResponse {
    fetched = 0,
    cached = 1,
    defaults = 2,
    error = 3
}
export declare class TogglyInitResponse {
    status: TogglyLoadFeatureFlagsResponse;
    constructor(status: TogglyLoadFeatureFlagsResponse);
}
