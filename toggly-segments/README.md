# @ops-ai/toggly-segments

Server-only client for adding and removing identifiers on existing Toggly targeting lists. Authenticate with a **Backend** application key. See [Syncing segment membership](https://docs.toggly.io/docs/core-concepts/segment-membership-sync).

```js
import { createSegmentMembershipClient } from '@ops-ai/toggly-segments'

const segments = createSegmentMembershipClient({ appKey: process.env.TOGGLY_APP_KEY })
await segments.addSegmentMembers('Beta Testers', ['user-123'])
```
