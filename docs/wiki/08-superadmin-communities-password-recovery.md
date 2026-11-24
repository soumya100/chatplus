# SuperAdmin, Communities and Password Recovery

## SuperAdmin access

Platform-level access is granted only by the server-side `SUPERADMIN_EMAILS` environment variable. Use a comma-separated list of exact, verified account email addresses. Do not use `NEXT_PUBLIC_*` variables, client-controlled profile fields, or a database role that a normal user can edit.

Example deployment setting:

```env
SUPERADMIN_EMAILS=platform-admin@your-domain.example
```

After changing the allowlist, sign out and sign back in so the NextAuth JWT is refreshed. SuperAdmins can inspect the paginated platform user directory, suspend/restore ordinary accounts, inspect group chats, and manage platform communities/groups. The dashboard exposes a recent administrative activity feed. Moderation audit events are written atomically with the account change and retained for 180 days. Direct one-to-one conversations remain private and are not exposed by SuperAdmin group moderation access. Account moderation is compare-and-set protected and audit logged.

## WhatsApp-style communities

A community follows the WhatsApp Communities mental model:
- One community home with the announcement group/feed at the top (admins can publish; members can read).
- Linked group chats displayed together below the announcement feed, plus the ability for community admins to create new group chats directly inside the community. Each group opens its own chat and keeps its own message history and membership controls.
- A separate Members view for community membership, invitations, and owner-managed admin roles.
- A community member directory, invitations, and owner-managed admin roles.
- A 2,000-member cap to bound atomic Redis transactions.

When a group is linked, its current members are included in the community. Later group-member additions are synchronized into the linked community. Linking/unlinking and community creation use Redis compare-and-set transactions to avoid competing community assignments and lost membership updates.

## Password recovery

Password reset requires the existing Resend configuration:
- `RESEND_API_KEY`
- `EMAIL_FROM` (a sender verified in Resend)

The request endpoint deliberately returns the same response for known and unknown email addresses. Reset tokens are 256-bit random values; only SHA-256 hashes are stored, the token expires after 30 minutes, and Redis Lua consumes it atomically once. A newer reset request invalidates the previous link. Reset URLs use the configured NEXTAUTH_URL only; the request Host header is never trusted as a link origin. The reset page sends a no-referrer policy to avoid leaking token URLs to other origins. Successful reset updates `passwordChangedAt`, causing previously issued JWT sessions to expire on their next refresh. OAuth-only accounts do not receive local password reset links.

## Validation

Pull-request CI runs:
- Unit/API regression and source-contract suites on Node 22 and 24
- Real Redis Lua integration for group, community, reset-token and moderation transactions
- TypeScript, lint, production build, HTTP smoke and Chromium/Firefox/WebKit smoke
- axe-core WCAG 2.2 AA audits of login, signup, OTP, forgot-password and invalid reset-link screens
- OWASP ZAP passive baseline and active unauthenticated scans, CodeQL, dependency review and secret scanning

The manually dispatched staging workflow additionally requires three group-role accounts plus an allowlisted SuperAdmin account. It validates member/admin/outsider boundaries, SuperAdmin cross-group access, and runs authenticated axe-core audits over the community hub and SuperAdmin dashboard. It must target an isolated HTTPS staging deployment only.
