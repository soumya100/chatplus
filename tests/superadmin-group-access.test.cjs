const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers/group-api-harness.cjs");

const groupManage = h.loadRoute("src/app/api/group/[groupId]/manage/route.ts");
const groupMembers = h.loadRoute("src/app/api/group/[groupId]/members/route.ts");
const groupFeatures = h.loadRoute("src/app/api/group/[groupId]/features/route.ts");
const deleteMessage = h.loadRoute("src/app/api/message/delete/route.ts");
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


test("SuperAdmin can delete a community without being its owner", async () => {
  h.reset();
  const created = await status(await communities.POST(h.request({ name: "Moderation target" })));
  const id = created.data.community.id;
  assert.ok(h.getSetMembers("communities").includes(id));
  h.setSession("root", "Platform admin", { isSuperAdmin: true });
  const removed = await status(await h.loadRoute("src/app/api/community/[communityId]/route.ts").POST(
    h.request({ action: "delete" }), { params: Promise.resolve({ communityId: id }) }
  ));
  assert.equal(removed.status, 200);
  assert.equal(h.getSetMembers("communities").includes(id), false);
});

test("SuperAdmin can use group activity tools and moderate group messages but cannot inspect direct chats", async () => {
  h.reset();
  process.env.SUPERADMIN_EMAILS = "root@example.test";
  h.setUser("root", { name: "Root", email: "root@example.test" });
  h.setSession("root", "Root", { email: "root@example.test", isSuperAdmin: true });

  const featuresResponse = await groupFeatures.POST(h.request({
    action: "announce", text: "Platform moderation notice",
  }), { params: Promise.resolve({ groupId: "g1" }) });
  const featuresText = await featuresResponse.text();
  assert.equal(featuresResponse.status, 200, "group feature access failed: " + featuresText);
  const features = { status: featuresResponse.status, data: JSON.parse(featuresText) };

  h.setMessages([{
    id: "moderation-target", senderId: "owner", receiverId: "group--g1",
    text: "Abusive group message", timestamp: 123,
  }], "g1");
  const moderatedResponse = await deleteMessage.POST(h.request({
    messageId: "moderation-target", chatId: "group--g1",
  }));
  const moderatedText = await moderatedResponse.text();
  assert.equal(moderatedResponse.status, 200, "group message moderation failed: " + moderatedText);
  const moderated = { status: moderatedResponse.status, data: JSON.parse(moderatedText) };
  assert.equal(h.getMessages("g1")[0].isDeleted, true);
  assert.equal(h.getMessages("g1")[0].text, "This message was deleted");

  h.setDirectMessages([{
    id: "private-message", senderId: "owner", receiverId: "member",
    text: "Private conversation", timestamp: 124,
  }], "owner", "member");
  const privateAttempt = await deleteMessage.POST(h.request({
    messageId: "private-message", chatId: "owner--member",
  }));
  assert.equal(privateAttempt.status, 403, "SuperAdmin moderation never bypasses direct-chat privacy");
});
