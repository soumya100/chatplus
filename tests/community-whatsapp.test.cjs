const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers/group-api-harness.cjs");

const create = h.loadRoute("src/app/api/community/route.ts");
const mutate = h.loadRoute("src/app/api/community/[communityId]/route.ts");
const announcements = h.loadRoute("src/app/api/community/[communityId]/announcements/route.ts");
const status = async response => ({ status: response.status, data: await response.json() });
const postCommunity = async (communityId, payload) => status(await mutate.POST(
  h.request(payload), { params: Promise.resolve({ communityId }) }
));
const postAnnouncement = async (communityId, payload) => status(await announcements.POST(
  h.request(payload), { params: Promise.resolve({ communityId }) }
));

test("community: creates WhatsApp-style announcement feed and indexes community globally", async () => {
  h.reset();
  const created = await status(await create.POST(h.request({ name: "Product", description: "Product teams" })));
  assert.equal(created.status, 201);
  const id = created.data.community.id;
  assert.ok(h.getSetMembers("communities").includes(id));
  const empty = await status(await announcements.GET(new Request("http://localhost"), { params: Promise.resolve({ communityId: id }) }));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.announcements, []);
});

test("community: only admins post announcements; members can read them", async () => {
  h.reset();
  const created = await status(await create.POST(h.request({ name: "Product" })));
  const id = created.data.community.id;
  assert.equal((await postCommunity(id, { action: "addMember", memberId: "member" })).status, 200);

  h.setSession("member");
  assert.equal((await postAnnouncement(id, { text: "Release notes" })).status, 403);
  assert.equal((await status(await announcements.GET(new Request("http://localhost"), { params: Promise.resolve({ communityId: id }) }))).status, 200);

  h.setSession("owner");
  assert.equal((await postCommunity(id, { action: "promoteAdmin", memberId: "member" })).status, 200);
  h.setSession("member", "Member");
  const posted = await postAnnouncement(id, { text: "  Release notes are ready  " });
  assert.equal(posted.status, 201);
  assert.equal(posted.data.announcement.text, "Release notes are ready");
  const listed = await status(await announcements.GET(new Request("http://localhost"), { params: Promise.resolve({ communityId: id }) }));
  assert.equal(listed.data.announcements.length, 1);
  assert.equal(listed.data.announcements[0].authorId, "member");
});

test("community: only owner can manage admins and owner cannot be demoted", async () => {
  h.reset();
  const created = await status(await create.POST(h.request({ name: "Design" })));
  const id = created.data.community.id;
  await postCommunity(id, { action: "addMember", memberId: "member" });
  h.setSession("member");
  assert.equal((await postCommunity(id, { action: "promoteAdmin", memberId: "member" })).status, 403);
  h.setSession("owner");
  assert.equal((await postCommunity(id, { action: "demoteAdmin", memberId: "owner" })).status, 400);
  assert.equal((await postCommunity(id, { action: "promoteAdmin", memberId: "member" })).status, 200);
  assert.equal((await postCommunity(id, { action: "demoteAdmin", memberId: "member" })).status, 200);
});

test("community: announcements reject invalid and oversized payloads", async () => {
  h.reset();
  const created = await status(await create.POST(h.request({ name: "Security" })));
  const id = created.data.community.id;
  assert.equal((await postAnnouncement(id, { text: " " })).status, 400);
  assert.equal((await postAnnouncement(id, { text: "x".repeat(2001) })).status, 400);
  h.setSession("other");
  assert.equal((await postAnnouncement(id, { text: "Unauthorized" })).status, 403);
});


test("community: linking a group atomically syncs all current members and rejects stale writers", async () => {
  h.reset();
  const created = await status(await create.POST(h.request({ name: "Workspace", groupIds: ["g1"] })));
  assert.equal(created.status, 201);
  const id = created.data.community.id;
  assert.equal(h.getGroup("g1").communityId, id);
  for (const memberId of ["owner", "admin", "member", "other"]) {
    assert.ok(h.getSetMembers(`user:${memberId}:communities`).includes(id));
  }

  h.reset();
  h.forceRedisConflicts(1);
  const conflict = await status(await create.POST(h.request({ name: "Stale workspace" })));
  assert.equal(conflict.status, 409);
  assert.equal(h.getSetMembers("communities").length, 0);
});

test("community: duplicate group selections are rejected before persistence", async () => {
  h.reset();
  const response = await status(await create.POST(h.request({ name: "Duplicate links", groupIds: ["g1", "g1"] })));
  assert.equal(response.status, 400);
  assert.equal(h.getSetMembers("communities").length, 0);
});

test("community home presents announcements and linked group chats together like WhatsApp Communities", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../src/components/Chat/WhatsAppCommunities.tsx"), "utf8");
  assert.match(source, /useState<"home" \| "members">\("home"\)/);
  assert.match(source, /activeTab === "home" && <section/);
  assert.match(source, /Group chats in this community/);
  assert.match(source, /Open group chat/);
  assert.match(source, /Community announcements/);
  assert.doesNotMatch(source, /id:"groups",label:"Groups"/);
});
