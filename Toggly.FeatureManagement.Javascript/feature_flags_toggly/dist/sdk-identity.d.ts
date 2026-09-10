export declare const SDK_ID = "javascript";
export declare const SDK_VERSION = "1.3.1";
export declare const SDK_HEADER_ID = "X-Toggly-Sdk";
export declare const SDK_HEADER_VERSION = "X-Toggly-Sdk-Version";
export declare function sdkUserAgent(): string;
export declare function sdkCustomHeaders(): Record<string, string>;
export declare function appendSdkQueryParams(params: URLSearchParams): void;
/** Browser and React Native use custom headers on HTTP (User-Agent is forbidden in browser fetch). */
export declare function usesSdkCustomHeaders(): boolean;
export declare function buildDefinitionFetchHeaders(existing?: Record<string, string>): Record<string, string>;
