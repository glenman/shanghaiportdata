# Security Specification & Payload-First Verification (Admin-Only Session Viewing)

## 1. Data Invariants
1. **Strict Admin-Only Read & Delete**: All reads (`get`, `list`) and deletions (`delete`) on `/chat_sessions/{sessionId}` and `/chat_sessions/{sessionId}/messages/{messageId}` are strictly restricted to the verified administrator (`request.auth != null && request.auth.token.email_verified == true && request.auth.token.email == 'glenman@gmail.com'`). Public visitors and non-admin accounts cannot read or list any conversation records.
2. **Master Gate Parent Integrity**: A `SessionMessage` cannot be created or updated unless the parent `/chat_sessions/{sessionId}` exists (or is created atomically in the same batch via `existsAfter`).
3. **Immutable Fields & Append-Only Integrity**: `id`, `sessionId`, `title` (on session), `role`, `content`, `clientTimestamp`, and `createdAt` are immutable after creation; `messageCount` cannot decrease; updates are restricted via `affectedKeys().hasOnly(...)` to summary updates or message feedback updates.
4. **Temporal Integrity**: `createdAt` must equal `request.time` on creation, and `updatedAt` must equal `request.time` on creation and every update.
5. **Bounded Payloads & ID Hardening**: All document IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), and all strings and arrays enforce strict size bounds.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return `PERMISSION_DENIED`)
1. **Public Session List**: Unauthenticated client calling `list` on `/chat_sessions`.
2. **Non-Admin Authenticated Read**: Non-admin signed-in user calling `get` or `list` on `/chat_sessions/{sessionId}` or `/messages`.
3. **Email Spoofing Attack**: Signed-in user with `email: 'glenman@gmail.com'` and `email_verified: false` calling `list` or `delete`.
4. **Non-Admin Delete**: Unauthenticated or non-admin user attempting `delete` on `/chat_sessions/{sessionId}` or a message.
5. **Shadow / Ghost Field Injection (Create)**: Creating a session or message with an extra `"isAdmin": true` field.
6. **Shadow / Ghost Field Injection (Update)**: Updating a message with `feedback: "like"` plus `"content": "tampered"`.
7. **Orphaned Message Create**: Creating `/chat_sessions/missing_id/messages/m1` when parent session does not exist.
8. **Immutable Field Tampering**: Updating a session's `title` or `createdAt`, or decreasing `messageCount`.
9. **Client Timestamp Forgery**: Creating a session or message with `createdAt` set to a client timestamp instead of `request.time`.
10. **ID Poisoning**: Creating a document with `sessionId = "bad/../../id"` or a 500-character document ID.
11. **Denial-of-Wallet String / Array Bomb**: Creating a message with `content` > 50,000 chars or `sources` array > 15 items or invalid source keys.
12. **Catch-All Denial**: Reading or writing any undeclared collection (e.g., `/users/{uid}` or `/secrets/{id}`).
