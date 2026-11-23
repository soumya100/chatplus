const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("SuperAdmin is configured only by a server-side email allowlist", () => {
  const helper = read("src/lib/superadmin.ts");
  const route = read("src/app/api/superadmin/overview/route.ts");
  const page = read("src/app/(dashboard)/dashboard/superadmin/page.tsx");
  assert.match(helper, /SUPERADMIN_EMAILS/);
  assert.match(route, /requireSuperAdmin/);
  assert.match(route, /Not found/);
  assert.match(route, /SuperAdmin accounts cannot be suspended/);
  assert.match(route, /superadmin-user-moderation-cas-v1/);
  assert.match(page, /isSuperAdminEmail/);
});

test("password reset stores hashed one-time tokens and consumes them atomically", () => {
  const request = read("src/app/api/auth/password-reset/request/route.ts");
  const confirm = read("src/app/api/auth/password-reset/confirm/route.ts");
  const auth = read("src/lib/auth.ts");
  assert.match(request, /randomBytes\(32\)/);
  assert.match(request, /createHash\("sha256"\)/);
  assert.match(request, /password-reset-request/);
  assert.match(request, /If an account matches/);
  assert.match(confirm, /consume-password-reset-token-v1/);
  assert.match(confirm, /passwordChangedAt/);
  assert.match(auth, /passwordChangedAt/);
});

test("WhatsApp-style communities have announcements, separate groups and owner-managed admins", () => {
  const ui = read("src/components/Chat/WhatsAppCommunities.tsx");
  const api = read("src/app/api/community/[communityId]/announcements/route.ts");
  const mutate = read("src/app/api/community/[communityId]/route.ts");
  assert.match(ui, /Announcements/);
  assert.match(ui, /Open group chat/);
  assert.match(ui, /Make admin/);
  assert.match(ui, /Invite by email address/);
  assert.match(api, /Only community admins can post announcements/);
  assert.match(api, /community-announcement-cas-v1/);
  assert.match(mutate, /promoteAdmin/);
  assert.match(mutate, /demoteAdmin/);
});
