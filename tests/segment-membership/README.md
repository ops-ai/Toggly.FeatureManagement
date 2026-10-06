# Segment membership HTTP contract

SDK clients implement this JSON against `https://app.toggly.io`.

- Auth: Backend application key in `Authorization` (raw or `Bearer`).
- Frontend and Mobile keys must be treated as 403.
- Do not send CORS credentials from a browser.
- Membership writes are eventually consistent with flag evaluation.

See `contract.json` in this folder.
