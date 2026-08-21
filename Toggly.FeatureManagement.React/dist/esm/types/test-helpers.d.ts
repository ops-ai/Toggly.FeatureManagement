export declare function createMockFetchResponse(body: unknown, status?: number, statusText?: string): {
    ok: boolean;
    status: number;
    statusText: string;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
};
