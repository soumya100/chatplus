const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers/group-api-harness.cjs");

const createCommunity = h.loadRoute("src/app/api/community/route.ts");
const createGroup = h.loadRoute("src/app/api/community/[communityId]/groups/route.ts");
const status = async response => ({ status: response.status, data: await response.json() });

test("community group creation atomically links the group and indexes every selected member", async () => {
  h.reset();
  const created = await status(await createCommunity.POST(h.request({ name: "Engineering", groupIds: ["g1"] })));
  const communityId = created.data.community.id;
  const response = await status(await createGroup.POST(
    h.request({ name: "Frontend", description: "Frontend work", memberIds: ["member", "admin"] }),
    { params: Promise.resolve({ communityId }) }
  ));
  assert.equal(response.status, 201);
  const group = response.data.group;
  assert.equal(group.communityId, communityId);
  assert.deepEqual(group.memberIds.sort(), ["admin", "member", "owner"]);
  assert.ok(h.getSetMembers("communities").includes(communityId));
  assert.ok(h.getSetMembers("groups").includes(group.id));
  assert.ok(h.getSetMembers("group:" + group.id + ":members").includes("member"));
  assert.ok(h.getSetMembers("user:member:groups").includes(group.id));
  const community = h.getCommunity(communityId);
  assert.ok(community.groupIds.includes(group.id));
});

test("community group creation rejects non-admins and users outside the community", async () => {
  h.reset();
  const created = await status(await createCommunity.POST(h.request({ name: "Design", groupIds: ["g1"] })));
  const communityId = created.data.community.id;
  h.setSession("member", "Member");
  const forbidden = await status(await createGroup.POST(
    h.request({ name: "Private group", memberIds: [] }),
    { params: Promise.resolve({ communityId }) }
  ));
  assert.equal(forbidden.status, 403);

  h.setSession("owner", "Owner");
  const invalidMember = await status(await createGroup.POST(
    h.request({ name: "Invalid member group", memberIds: ["outsider"] }),
    { params: Promise.resolve({ communityId }) }
  ));
  assert.equal(invalidMember.status, 400);
});

test("SuperAdmin can create a group in a community and is indexed as a member for moderation", async () => {
  h.reset();
  const created = await status(await createCommunity.POST(h.request({ name: "Platform team", groupIds: ["g1"] })));
  const communityId = created.data.community.id;
  h.setSession("root", "Platform admin", { isSuperAdmin: true });
  const response = await status(await createGroup.POST(
    h.request({ name: "Platform review", memberIds: ["member"] }),
    { params: Promise.resolve({ communityId }) }
  ));
  assert.equal(response.status, 201);
  assert.ok(response.data.group.adminIds.includes("root"));
  assert.ok(h.getSetMembers("user:root:communities").includes(communityId));
  assert.ok(h.getSetMembers("user:root:groups").includes(response.data.group.id));
});
