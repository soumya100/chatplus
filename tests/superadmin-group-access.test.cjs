const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers/group-api-harness.cjs");

const groupManage = h.loadRoute("src/app/api/group/[groupId]/manage/route.ts");
const groupMembers = h.loadRoute("src/app/api/group/[groupId]/members/route.ts");
const communities = h.loadRoute("src/app/api/community/route.ts");
const status = async response => ({ status: response.status, data: await response.json() });

test("SuperAdmin can manage group details and inspect members without group membership", async () => {
  h.reset();
  h.setSession("root", "Platform admin", { isSuperAdmin: true });
  const ctx = { params: Promise.resolve({ groupId: "g1" }) };
  const updated = await status(await groupManage.POST(h.request({
    action: "update", name: "Moderated group", settings: { onlyAdminsCanSendMessages: true },
  }), ctx));
  assert.equal(updated.status, 200);
  assert.equal(updated.data.group.name, "Moderated group");

  const members = await status(await groupMembers.GET(new Request("http://localhost"), ctx));
  assert.equal(members.status, 200);
  assert.equal(members.data.memberCount, 4);
});

test("SuperAdmin can access all community records through the normal community hub API", async () => {
  h.reset();
  const created = await status(await communities.POST(h.request({ name: "Existing community" })));
  assert.equal(created.status, 201);
  h.setSession("root", "Platform admin", { isSuperAdmin: true });
  const listing = await status(await communities.GET());
  assert.equal(listing.status, 200);
  assert.equal(listing.data.communities.length, 1);
  assert.equal(listing.data.communities[0].isSuperAdmin, true);
  assert.equal(listing.data.communities[0].isAdmin, true);
});
