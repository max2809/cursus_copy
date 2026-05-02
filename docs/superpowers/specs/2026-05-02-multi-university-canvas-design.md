# Multi-University Canvas Support Design

## Goal

Cursus stays invite-only, but each allowlisted user can connect a Personal Access Token from their own Canvas university instead of being locked to `canvas.eur.nl`.

## Non-Goals

- Do not open public signup.
- Do not infer Canvas hosts from email domains.
- Do not add billing, quotas, or a broader auth provider.
- Do not support multiple Canvas hosts per Cursus account in this change; each user has one active Canvas host.

## Current Behavior

The magic-link flow already uses the `users` table as an allowlist. Unknown emails receive the same `{"ok": true}` response but no token is created or emailed.

The database already has `users.canvas_base_url`, and sync uses that per-user value. The onboarding endpoint does not use it during PAT validation yet. It validates all submitted PATs against the global backend setting:

```text
https://{CANVAS_BASE_URL}/api/v1/users/self
```

This rejects valid PATs from other Canvas institutions.

## Proposed Behavior

Onboarding and settings collect two values:

- `canvas_base_url`: the user's Canvas URL or domain, such as `canvas.eur.nl`, `https://canvas.harvard.edu`, or `school.instructure.com`.
- `pat`: the user's Canvas Personal Access Token.

The frontend posts both values to:

```http
POST /api/onboarding/pat
```

The backend normalizes the Canvas input to a safe hostname, validates the PAT against:

```text
https://{normalized_canvas_host}/api/v1/users/self
```

If Canvas accepts the PAT, the backend saves:

- encrypted PAT
- PAT nonce
- normalized `users.canvas_base_url`

Then the existing background sync runs. Because sync already reads `user.canvas_base_url`, courses, deadlines, files, pages, syllabus downloads, citations, and material downloads continue through the selected Canvas host.

## Security Rules

The backend must treat `canvas_base_url` as untrusted user input because it controls an outbound server request.

Normalization and validation rules:

- Accept either a bare hostname or an HTTPS URL.
- Strip path/query/fragment from full URLs.
- Store only the normalized lowercase hostname.
- Reject empty values.
- Reject non-HTTPS URL schemes.
- Reject usernames/passwords in URLs.
- Reject explicit ports.
- Reject `localhost`, `.local`, `.internal`, and other non-public hostnames.
- Reject IP literals.
- Resolve DNS before making the Canvas request and reject hosts resolving to private, loopback, link-local, multicast, reserved, or unspecified addresses.

These rules prevent the onboarding endpoint from becoming an SSRF primitive while still allowing ordinary Canvas custom domains and `*.instructure.com` hosts.

## Backend API

`PATPayload` changes from:

```json
{ "pat": "..." }
```

to:

```json
{ "pat": "...", "canvas_base_url": "canvas.example.edu" }
```

For compatibility, missing `canvas_base_url` should fall back to the current user's saved `canvas_base_url`, then to `settings.canvas_base_url`.

Add a small authenticated account endpoint so settings can prefill the current Canvas host:

```http
GET /api/auth/me
```

Response:

```json
{
  "email": "person@example.edu",
  "canvas_base_url": "canvas.example.edu",
  "has_pat": true
}
```

## Frontend UX

Onboarding:

- Add a required `Canvas URL or domain` input above the token input.
- Default to `canvas.eur.nl` only as a convenience for existing EUR use.
- Update the instructions link dynamically to `https://{canvas_domain}/profile/settings` after the user enters a domain.
- Submit both `canvas_base_url` and `pat`.
- Show a domain-specific error when the host is invalid.
- Keep the existing rejected-token message for 401 responses.

Settings:

- Fetch `/api/auth/me`.
- Prefill the Canvas domain from `me.canvas_base_url`.
- Let the user update the Canvas domain and PAT together.
- Warn through copy that changing the domain replaces the Canvas connection and future syncs use the new host.

## Error Handling

Backend errors should be stable enough for the frontend to show useful messages:

- Invalid or unsafe host: `400`, detail `Invalid Canvas domain`
- Canvas token rejected: `400`, detail `Canvas rejected that token`
- Canvas host unreachable or unexpected Canvas error: `400`, detail `Could not reach that Canvas domain`

The frontend can map these details to short user-facing messages.

## Testing

Backend tests:

- A PAT from `canvas.other.edu` is validated against `https://canvas.other.edu/api/v1/users/self`.
- Successful onboarding saves `user.canvas_base_url = "canvas.other.edu"`.
- Missing `canvas_base_url` keeps backwards compatibility by using the current saved host.
- Invalid domains are rejected before `httpx` is called.
- Localhost, IP literals, explicit ports, non-HTTPS schemes, and private DNS results are rejected.

Frontend tests:

- `useSubmitPat` sends both `pat` and `canvas_base_url`.
- Onboarding renders and submits a Canvas domain field.
- Settings can prefill and submit the saved Canvas domain.

Verification:

- Run backend onboarding/auth tests first.
- Run full backend pytest.
- Run frontend tests.
- Run frontend production build with `VITE_API_BASE_URL` set.

## Rollout

This is backwards compatible for existing EUR users because `users.canvas_base_url` defaults to `canvas.eur.nl`, and existing saved tokens remain usable. New users from other universities must enter their Canvas host during onboarding before submitting the PAT.
