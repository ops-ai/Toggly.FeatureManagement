export interface SegmentSummary {
    id: string;
    name: string;
    environment?: string | null;
    itemCount: number;
}
export interface SegmentMember {
    identifier: string;
    description?: string | null;
}
export interface SegmentItemsPage {
    items: SegmentMember[];
    skip: number;
    take: number;
    total: number;
}
export interface SegmentMembershipClientOptions {
    appKey: string;
    baseUrl?: string;
    fetch?: typeof fetch;
}
export declare class SegmentMembershipError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare function createSegmentMembershipClient(options: SegmentMembershipClientOptions): {
    listSegments(): Promise<SegmentSummary[]>;
    listItems(segment: string, skip?: number, take?: number): Promise<SegmentItemsPage>;
    addSegmentMembers(segment: string, identifiers: string[]): Promise<SegmentSummary>;
    removeSegmentMembers(segment: string, identifiers: string[]): Promise<SegmentSummary>;
    replaceSegmentMembers(segment: string, identifiers: string[]): Promise<SegmentSummary>;
};
export type SegmentMembershipClient = ReturnType<typeof createSegmentMembershipClient>;
