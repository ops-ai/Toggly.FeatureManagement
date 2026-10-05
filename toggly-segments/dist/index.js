"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SegmentMembershipError = void 0;
exports.createSegmentMembershipClient = createSegmentMembershipClient;
class SegmentMembershipError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'SegmentMembershipError';
    }
}
exports.SegmentMembershipError = SegmentMembershipError;
function createSegmentMembershipClient(options) {
    const baseUrl = (options.baseUrl ?? 'https://app.toggly.io').replace(/\/+$/, '');
    const http = options.fetch ?? fetch;
    const headers = {
        Authorization: options.appKey,
        'Content-Type': 'application/json',
    };
    async function request(method, path, body) {
        const response = await http(`${baseUrl}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) {
            throw new SegmentMembershipError(`Segment membership ${method} ${path} failed`, response.status);
        }
        if (response.status === 204) {
            return undefined;
        }
        return (await response.json());
    }
    return {
        listSegments() {
            return request('GET', '/api/v2/segments');
        },
        listItems(segment, skip = 0, take = 100) {
            const params = new URLSearchParams({ skip: String(skip), take: String(take) });
            return request('GET', `/api/v2/segments/${encodeURIComponent(segment)}/items?${params}`);
        },
        addSegmentMembers(segment, identifiers) {
            return request('POST', `/api/v2/segments/${encodeURIComponent(segment)}/items`, { identifiers });
        },
        removeSegmentMembers(segment, identifiers) {
            return request('DELETE', `/api/v2/segments/${encodeURIComponent(segment)}/items`, { identifiers });
        },
        replaceSegmentMembers(segment, identifiers) {
            return request('PUT', `/api/v2/segments/${encodeURIComponent(segment)}/items`, { identifiers });
        },
    };
}
