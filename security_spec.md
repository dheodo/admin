# Security Specification & Threat Model

This document outlines the security architecture and validation constraints governing the project showcase Firestore database.

## 1. Data Invariants

1. **Global Read Access**: Project showcases are public. Anyone (including anonymous/unregistered visitors) can read single projects or query the collection list to view the main web showcase.
2. **Restricted Writes**: Only signed-in users with a verified email address can publish (`create`), update, or `delete` projects.
3. **Owner Integrity**: A user can only create or edit projects where `ownerId` strictly matches their own authorized `request.auth.uid`. They cannot author or edit projects for other users.
4. **ID Hygiene**: Document IDs must match the alphanumeric pattern and must be validated using `isValidId` check of up to 128 characters.
5. **Static Field Validation**: Projects must adhere strictly to predefined size and type limits for string parameters (`name`, `subtitle`, `category`, `imageUrl`, `detail`) to protect against buffer overflow or Denial of Wallet attacks.
6. **Temporal Immutability**: The `createdAt` date cannot be overwritten or altered during an `update`. The `updatedAt` field must always match the server-generated `request.time`.

## 2. The Dirty Dozen Payloads

Below are twelve malicious payloads designed to compromise Identity, Integrity, or State, which the Fortress Rules will block:

1. **Spoofed Owner ID**: `create` payload setting `ownerId: "hacker_uid"` when the authed user is `"victim_uid"`.
2. **Orphaned Database Creation**: `create` payload bypasses authenticated credentials (`request.auth == null`).
3. **Unverified Email Modification**: Write check submitted by a user where `email_verified == false` attempts to insert or modify projects.
4. **Giant ID injection**: Document ID is highly nested or extremely large string (e.g. 5KB) to cause indexing issues.
5. **Ghost field insertion**: `create` payload including `isAdmin: true` or `flagged: false` to corrupt the state map.
6. **Negative or massive limits**: `create` payload with `name` exceeding 200 characters or `detail` exceeding 50,000 characters.
7. **Type confusion attack**: `create` payload where `createdAt` or `updatedAt` is passed as a string or number instead of a Timestamp.
8. **Immutability violation**: `update` payload where `createdAt` is changed from its original value.
9. **Shadow parameter override**: `update` payload attempting to silently alter `ownerId` to hijack the project's ownership.
10. **Malicious Empty Fields**: Zero-character strings for `name`, `imageUrl`, or `category` to break frontend layout rendering.
11. **Inject empty tags**: Passing extra arrays inside the database payload that aren't defined in the validation blueprint.
12. **Unauthorized Deletion**: `victim_uid`'s project deleted by `malicious_uid`.

---

## 3. The Security Rule Blueprint (`firestore.rules`)

To see the rules implementation that validates this threat model, refer to `/firestore.rules`.
