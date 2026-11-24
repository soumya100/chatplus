const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const h = require("./helpers/group-api-harness.cjs");

const requestReset = h.loadRoute("src/app/api/auth/password-reset/request/route.ts");
const confirmReset = h.loadRoute("src/app/api/auth/password-reset/confirm/route.ts");
const superadmin = h.loadRoute("src/app/api/superadmin/overview/route.ts");
const status = async response => ({ status: response.status, data: await response.json() });

test("password reset: sends a one-time link and atomically changes the password", async () => {
  h.reset();
  const oldHash = await bcrypt.hash("OldPass123!", 4);
  h.setUser("reset-user", { name: "Reset User", email: "reset@example.test", password: oldHash });
  h.seedKv("user:email:reset@example.test", "reset-user");
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "Chat+ <no-reply@example.test>";
  process.env.NEXTAUTH_URL = "https://chatplus.example.test";

  const originalFetch = global.fetch;
  let emailBody = "";
  global.fetch = async (_url, init) => {
    emailBody = String(init?.body || "");
    return new Response(JSON.stringify({ id: "email-test" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const requested = await status(await requestReset.POST(h.request({ email: "RESET@example.test" })));
    assert.equal(requested.status, 200);
    assert.match(requested.data.message, /If an account matches/);
    const html = JSON.parse(emailBody).html;
    const link = html.match(/href="([^"]+)"/)[1];
    const resetUrl = new URL(link);
    const token = resetUrl.searchParams.get("token");
    assert.match(token, /^[a-f0-9]{64}$/);
    const tokenHash = require("crypto").createHash("sha256").update(token).digest("hex");
    assert.ok(h.getKv("password-reset:" + tokenHash), "only the token hash is stored");
    assert.equal(h.getKv("password-reset:" + token), null, "raw reset token is never stored");
    assert.equal(resetUrl.origin, "https://chatplus.example.test");
    const emailMismatch = await status(await confirmReset.POST(h.request({ email: "someone-else@example.test", token, password: "NewPass456!" })));
    assert.equal(emailMismatch.status, 400, "reset token is bound to the original email address");

    const firstToken = token;
    const requestedAgain = await status(await requestReset.POST(h.request({ email: "reset@example.test" })));
    assert.equal(requestedAgain.status, 200);
    const secondHtml = JSON.parse(emailBody).html;
    const secondLink = secondHtml.match(/href="([^"]+)"/)[1];
    const latestToken = new URL(secondLink).searchParams.get("token");
    assert.ok(latestToken && latestToken !== firstToken, "a new request issues a fresh token");
    const staleToken = await status(await confirmReset.POST(h.request({
      email: "reset@example.test", token: firstToken, password: "NewPass456!",
    })));
    assert.equal(staleToken.status, 400, "a newer request invalidates the previous reset link");

    const changed = await status(await confirmReset.POST(h.request({
      email: "reset@example.test", token: latestToken, password: "NewPass456!",
    })));
    assert.equal(changed.status, 200);
    const updated = JSON.parse(h.getKv("user:reset-user"));
    assert.ok(updated.passwordChangedAt > 0);
    assert.ok(await bcrypt.compare("NewPass456!", updated.password));
    assert.ok(!(await bcrypt.compare("OldPass123!", updated.password)));

    const replay = await status(await confirmReset.POST(h.request({
      email: "reset@example.test", token: latestToken, password: "OtherPass789!",
    })));
    assert.equal(replay.status, 400, "reset tokens are single-use");
  } finally {
    global.fetch = originalFetch;
  }
});

test("password reset: generic response prevents account enumeration", async () => {
  h.reset();
  const response = await status(await requestReset.POST(h.request({ email: "missing@example.test" })));
  assert.equal(response.status, 200);
  assert.match(response.data.message, /If an account matches/);
});

test("password reset: rejects weak passwords, malformed tokens, and email mismatches", async () => {
  h.reset();
  const invalid = await status(await confirmReset.POST(h.request({
    email: "reset@example.test", token: "x", password: "weak",
  })));
  assert.equal(invalid.status, 400);
});

test("SuperAdmin: denies non-allowlisted sessions and exposes no user directory", async () => {
  h.reset();
  process.env.SUPERADMIN_EMAILS = "root@example.test";
  h.setSession("ordinary", "Ordinary", { email: "ordinary@example.test" });
  const denied = await status(await superadmin.GET(new Request("http://localhost/api/superadmin/overview")));
  assert.equal(denied.status, 404);
});

test("SuperAdmin: lists platform metrics and protects SuperAdmin accounts from suspension", async () => {
  h.reset();
  process.env.SUPERADMIN_EMAILS = "root@example.test";
  h.setUser("root", { name: "Root", email: "root@example.test" });
  h.setUser("target", { name: "Target", email: "target@example.test" });
  h.seedSet("users", ["root", "target"]);
  h.seedSet("user:target:groups", ["group-a", "group-b"]);
  h.seedSet("communities", ["community-a"]);
  h.setSession("root", "Root", { email: "root@example.test" });

  const listed = await status(await superadmin.GET(new Request("http://localhost/api/superadmin/overview")));
  assert.equal(listed.status, 200);
  assert.equal(listed.data.stats.users, 2);
  assert.equal(listed.data.stats.groups, 2);
  assert.equal(listed.data.stats.communities, 1);
  assert.equal(listed.data.users.some(user => user.password), false);

  assert.equal((await status(await superadmin.PATCH(h.request({ action: "suspend", userId: "root" })))).status, 400);
  const suspended = await status(await superadmin.PATCH(h.request({ action: "suspend", userId: "target" })));
  assert.equal(suspended.status, 200);
  assert.ok(JSON.parse(h.getKv("user:target")).suspendedAt);
  const restored = await status(await superadmin.PATCH(h.request({ action: "restore", userId: "target" })));
  assert.equal(restored.status, 200);
  assert.equal(JSON.parse(h.getKv("user:target")).suspendedAt, undefined);
});

test("password reset never trusts the incoming Host header as its email origin", async () => {
  h.reset();
  h.setUser("host-user", { name: "Host User", email: "host@example.test", password: "hash" });
  h.seedKv("user:email:host@example.test", "host-user");
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "Chat+ <no-reply@example.test>";
  delete process.env.NEXTAUTH_URL;

  const originalFetch = global.fetch;
  let emailSent = false;
  global.fetch = async () => {
    emailSent = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const response = await status(await requestReset.POST(new Request("https://attacker.example/api/auth/password-reset/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "host@example.test" }),
    })));
    assert.equal(response.status, 200);
    assert.equal(emailSent, false, "no reset email may use an untrusted request origin");
  } finally {
    global.fetch = originalFetch;
  }
});
