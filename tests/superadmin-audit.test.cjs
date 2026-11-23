const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers/group-api-harness.cjs");

const overview = h.loadRoute("src/app/api/superadmin/overview/route.ts");
const audit = h.loadRoute("src/app/api/superadmin/audit/route.ts");
const status = async response => ({ status: response.status, data: await response.json() });

test("SuperAdmin audit feed is denied to non-allowlisted sessions", async () => {
  h.reset();
  process.env.SUPERADMIN_EMAILS = "root@example.test";
  h.setSession("ordinary", "Ordinary", { email: "ordinary@example.test" });
  const response = await status(await audit.GET(new Request("http://localhost/api/superadmin/audit")));
  assert.equal(response.status, 404);
});

test("SuperAdmin moderation writes audit data atomically and exposes newest events", async () => {
  h.reset();
  process.env.SUPERADMIN_EMAILS = "root@example.test";
  h.setUser("root", { name: "Root", email: "root@example.test" });
  h.setUser("target", { name: "Target", email: "target@example.test" });
  h.seedSet("users", ["root", "target"]);
  h.setSession("root", "Root", { email: "root@example.test" });

  const changed = await status(await overview.PATCH(h.request({ action: "suspend", userId: "target" })));
  assert.equal(changed.status, 200);

  const events = await status(await audit.GET(new Request("http://localhost/api/superadmin/audit?limit=25")));
  assert.equal(events.status, 200);
  assert.equal(events.data.events.length, 1);
  assert.equal(events.data.events[0].action, "suspend");
  assert.equal(events.data.events[0].actorEmail, "root@example.test");
  assert.equal(events.data.events[0].targetUserId, "target");
});
