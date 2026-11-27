const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

test("the API route inventory is complete and every route exports an HTTP handler", () => {
  const apiRoot = path.join(root, "src/app/api");
  const routes = walk(apiRoot).filter(file => /route\.(ts|js)$/.test(file));
  assert.equal(routes.length, 41, "update this inventory assertion when adding or removing API routes");

  for (const file of routes) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)|export\s+\{\s*handler\s+as\s+GET,\s*handler\s+as\s+POST\s*\}/, path.relative(root, file));
  }
});

test("protected API routes have an explicit authentication boundary", () => {
  const apiRoot = path.join(root, "src/app/api");
  const routes = walk(apiRoot).filter(file => /route\.(ts|js)$/.test(file));
  const publicProtocolRoutes = new Set([
    "auth/[...nextauth]/route.ts",
    "auth/register/route.ts",
    "auth/email-otp/route.ts",
    "auth/email-otp/verify/route.ts",
    "auth/password-reset/request/route.ts",
    "auth/password-reset/confirm/route.ts",
  ]);

  for (const file of routes) {
    const relative = path.relative(apiRoot, file).replaceAll(path.sep, "/");
    if (publicProtocolRoutes.has(relative)) continue;
    const source = fs.readFileSync(file, "utf8");
    assert.match(
      source,
      /getServerSession|getToken|CRON_SECRET|Authorization|authorization|authOptions/,
      `No explicit auth boundary found in ${relative}`
    );
  }

  const resetRequest = read("src/app/api/auth/password-reset/request/route.ts")
  const resetConfirm = read("src/app/api/auth/password-reset/confirm/route.ts")
  assert.ok(resetRequest.includes("rateLimit"))
  assert.ok(resetRequest.includes("randomBytes(32)"))
  assert.ok(resetRequest.includes('createHash("sha256")'))
  assert.ok(resetRequest.includes("If an account matches"))
  assert.ok(resetConfirm.includes("token: z.string().regex"))
  assert.ok(resetConfirm.includes("consume-password-reset-token-v1"))
  assert.ok(resetConfirm.includes("rateLimit"))
});

test("chat mounts the member manager and activity panel instead of only toggling state", () => {
  const source = read("src/components/Chat/index.tsx");
  assert.match(source, /<GroupMembersManager\b/);
  assert.match(source, /<GroupFeaturesPanel\b/);
  assert.match(source, /setIsMembersManagerOpen\(true\)/);
  assert.match(source, /setIsGroupFeaturesOpen\(true\)/);
});

test("group update subscriptions use the same event names as the management API", () => {
  const chat = read("src/components/Chat/index.tsx");
  const manage = read("src/app/api/group/[groupId]/manage/route.ts");
  for (const eventName of ["group_updated", "group_deleted", "group_removed"]) {
    assert.ok(chat.includes(eventName), `chat is missing subscription for ${eventName}`);
    assert.ok(manage.includes(eventName), `API is missing event emission for ${eventName}`);
  }
});

test("member profile endpoint applies membership authorization and a field allow-list", () => {
  const source = read("src/app/api/group/[groupId]/members/route.ts");
  assert.match(source, /getServerSession\(authOptions\)/);
  assert.match(source, /memberIds\s*\|\|\s*\[\]\)\.includes\(userId\)/);
  assert.match(source, /return\s*\{\s*id,\s*name:/);
  assert.doesNotMatch(source, /return\s*\{[^}]*email:/s);
});

test("group member removal confirmation closes independently from the parent dialog", () => {
  const source = read("src/components/Chat/GroupMembersManager.tsx");
  for (const term of ["promote", "demote", "remove", "DialogUI", "confirmRemoveMember", "toast.error", "onGroupUpdated"]) {
    assert.ok(source.includes(term), `member manager is missing ${term}`);
  }
  assert.match(source, /onClose=\{\(\)\s*=>\s*\{\s*if\s*\(!isRemoveDialogOpen\)\s*onClose\(\)/);
  assert.match(source, /closeHandler=\{\(open\)\s*=>\s*\{\s*setIsRemoveDialogOpen\(open\)/);
  assert.match(source, /onClick=\{\(\)\s*=>\s*\{\s*setIsRemoveDialogOpen\(false\);\s*setPendingRemovalId\(null\)\s*\}\}/);
  assert.doesNotMatch(source, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
});

test("application source contains no native browser alert, confirm, or prompt calls", () => {
  const sourceRoot = path.join(root, "src");
  const sourceFiles = walk(sourceRoot).filter(file => /\.(?:[cm]?[jt]sx?)$/.test(file));
  const nativeDialogCall = /\b(?:(?:window|globalThis)\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/;

  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, nativeDialogCall, `Native browser dialog call found in ${path.relative(root, file)}`);
  }
});

test("group settings keep admin-only controls, tabs, and responsive modal boundaries", () => {
  const source = read("src/components/Chat/GroupSettingsModal.tsx");
  for (const term of ["general", "permissions", "privacy", "isAdmin", "max-h-[100dvh]", "overflow-hidden"]) {
    assert.ok(source.includes(term), `settings modal is missing ${term}`);
  }
  assert.match(source, /GroupPrivacySettings/);
});

test("privacy settings serialize writes and restore state after a failed request", () => {
  const source = read("src/components/Chat/GroupPrivacySettings.tsx");
  assert.match(source, /if\s*\(saving\)\s*return/);
  assert.match(source, /setPreferences\(previous\)/);
  assert.match(source, /disabled=\{saving\}/);
});

test("group activity preserves drafts when an API mutation fails", () => {
  const source = read("src/components/Chat/GroupFeaturesPanel.tsx");
  assert.match(source, /const\s+saved\s*=\s*await\s+act/);
  assert.match(source, /if\s*\(saved\)/);
  assert.match(source, /toast\.error/);
});

test("group routes use Next.js 15 async route params", () => {
  for (const relative of [
    "src/app/api/group/[groupId]/members/route.ts",
    "src/app/api/group/[groupId]/manage/route.ts",
    "src/app/api/group/[groupId]/features/route.ts",
    "src/app/api/group/[groupId]/pin/route.ts",
  ]) {
    const source = read(relative);
    assert.match(source, /params:\s*Promise<\{\s*groupId:\s*string\s*\}>/);
    assert.doesNotMatch(source, /params\.groupId/);
  }
});

test("the group settings and activity APIs use bounded validation and membership checks", () => {
  const manage = read("src/app/api/group/[groupId]/manage/route.ts");
  const features = read("src/app/api/group/[groupId]/features/route.ts");
  const pins = read("src/app/api/group/[groupId]/pin/route.ts");
  const privacy = read("src/app/api/user/group-preferences/route.ts");

  assert.match(manage, /discriminatedUnion/);
  assert.match(manage, /max\(500\)/);
  assert.match(features, /options:\s*z\.array/);
  assert.match(features, /\.max\(10\)/);
  assert.match(features, /memberIds\s*\|\|\s*\[\]\)\.includes\(userId\)/);
  assert.match(pins, /messageId:\s*z\.string\(\)\.min\(1\)/);
  assert.match(pins, /message\.senderId\s*==\s*"system"\s+or\s+message\.isDeleted/);
  assert.match(privacy, /notifications:\s*z\.enum\(\["all",\s*"muted"\]\)/);
});


test("group message sending preserves creator permissions for legacy empty admin lists", () => {
  const source = read("src/app/api/message/send/route.ts");
  // The legacy fallback (empty adminIds -> creator administers) lives in the
  // shared resolveAdminIds helper; every group route must derive admins there.
  assert.match(source, /resolveAdminIds\(group\)\.includes\(session\.user\.id\)/);
  assert.match(read("src/lib/group.ts"), /group\.adminIds\?\.length\s*\?\s*group\.adminIds\s*:\s*\[group\.creatorId\]/);
  assert.match(source, /onlyAdminsCanSendMessages\s*\|\|\s*group\.settings\?\.announcementsOnly/);
  assert.match(source, /Request body must be valid JSON/);
});

test("member invitations enforce explicit admin-approval and disabled-invite policies", () => {
  const source = read("src/app/api/group/members/add/route.ts");
  assert.match(source, /approvalRequired\s*&&\s*!isAdmin/);
  assert.match(source, /allowMemberInvites\s*===\s*false/);
  assert.match(source, /Promise\.allSettled/);
});


test("global controls use accessible premium checkbox and radio styling", () => {
  const styles = read("src/app/globals.css");
  assert.match(styles, /input\[type="checkbox"\][\s\S]*input\[type="radio"\]/);
  assert.match(styles, /input\[type="checkbox"\]:checked\s*\{[\s\S]*background-image:/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /:disabled/);
  assert.match(styles, /html\.dark input\[type="checkbox"\]/);
});

test("dark application canvas matches the login slate background", () => {
  const styles = read("src/app/globals.css");
  const layout = read("src/app/layout.tsx");
  assert.match(styles, /html\.dark body\s*\{[\s\S]*background-color:\s*#020617/);
  assert.match(layout, /dark:bg-slate-950/);
  assert.match(layout, /color:\s*"#020617"/);
});

test("community management supports discovery, editing, group organization and owner deletion", () => {
  const source = read("src/components/Chat/CommunitiesPanel.tsx");
  const api = read("src/app/api/community/[communityId]/route.ts");
  assert.match(source, /Search communities/);
  assert.match(source, /action: "update"/);
  assert.match(source, /action:"addGroup"/);
  assert.match(source, /action:"removeGroup"/);
  assert.match(source, /type: "delete"/);
  assert.match(source, /type: "leave"/);
  assert.match(source, /memberInput\[community\.id\]/);
  assert.match(source, /Manage community/);
  assert.match(api, /z\.literal\("delete"\)/);
  assert.match(api, /Only the community owner can delete it/);
  assert.match(api, /user:\$\{memberId\}:communities/);
});

test("group activity refreshes without hiding the panel and disables duplicate event responses", () => {
  const source = read("src/components/Chat/GroupFeaturesPanel.tsx");
  assert.match(source, /await load\(false\)/);
  assert.match(source, /disabled=\{busy\} onClick=\{\(\)=>act\(\{action:"respondEvent"/);
});


test("Redis operations probe is secret-authenticated and exposes only aggregate queue metrics", () => {
  const source = read("src/app/api/health/redis/route.ts");
  assert.match(source, /authorization.*Bearer/);
  assert.match(source, /db\.ping\(\)/);
  assert.match(source, /chat:expiring/);
  assert.match(source, /media:cleanup/);
  assert.match(source, /media:orphans/);
  assert.match(source, /Do not leak Redis URLs, tokens, commands or raw provider errors/);
  assert.doesNotMatch(source, /UPSTASH_REDIS_REST_TOKEN|UPSTASH_REDIS_REST_URL/);
});


test("offline messaging persists requests in IndexedDB and replays them with stable idempotency IDs", () => {
  const queue = read("src/lib/offline-message-queue.ts");
  const chat = read("src/components/Chat/index.tsx");
  assert.match(queue, /indexedDB\.open/);
  assert.match(queue, /createObjectStore\(STORE_NAME, \{ keyPath: "id" \}\)/);
  assert.match(queue, /createIndex\("chatId"/);
  assert.match(queue, /MAX_QUEUED_MESSAGES_PER_CHAT = 200/);
  assert.match(queue, /export async function enqueueOfflineMessage/);
  assert.match(queue, /export async function listOfflineMessages/);
  assert.match(queue, /export async function removeOfflineMessage/);
  assert.match(chat, /addEventListener\('online'/);
  assert.match(chat, /addEventListener\('focus'/);
  assert.match(chat, /addEventListener\('visibilitychange'/);
  assert.match(chat, /listOfflineMessages\(chatId\)/);
  assert.match(chat, /requestId: tempId/);
  assert.match(chat, /status: 'queued'/);
  assert.match(chat, /removeOfflineMessage\(record\.id\)/);
});

test("upload endpoint applies a per-user quota before minting Blob upload tokens", () => {
  const source = read("src/app/api/upload/route.ts");
  assert.match(source, /rateLimit\(session\.user\.id, "blob_upload", \{ limit: 10, windowSeconds: 60 \* 60 \}\)/);
  assert.match(source, /UPLOAD_RATE_LIMITED/);
  assert.match(source, /status: message === "Unauthorized" \? 401 : message === "UPLOAD_RATE_LIMITED" \? 429 : 400/);
});

test("rate limiting is performed in a single Redis Lua transaction", () => {
  const source = read("src/lib/ratelimit.ts");
  assert.match(source, /sliding-window-rate-limit-v1/);
  assert.match(source, /ZREMRANGEBYSCORE/);
  assert.match(source, /ZADD/);
  assert.match(source, /ZCARD/);
  assert.match(source, /db\.eval\(/);
  assert.doesNotMatch(source, /db\.pipeline\(/);
});


test("chat search uses debounced server-side history results and cancels stale requests", () => {
  const chat = read("src/components/Chat/index.tsx");
  const search = read("src/app/api/message/search/route.ts");
  assert.match(chat, /api\/message\/search\?chatId=/);
  assert.match(chat, /window\.setTimeout/);
  assert.match(chat, /controller\.abort\(\)/);
  assert.match(chat, /results\.forEach\(message => merged\.set/);
  assert.match(search, /zrange\(\`chat:\$\{chatId\}:messages\`, -500, -1\)/);
  assert.match(search, /results\.slice\(0, 50\)/);
});


test("message persistence accepts both Upstash auto-deserialized objects and raw JSON strings", () => {
  const source = read("src/app/api/message/send/route.ts");
  assert.match(source, /function decodeRedisJson<T>\(value: unknown\): T/);
  assert.match(source, /typeof value === "string" \? JSON\.parse\(value\) : value/);
  assert.match(source, /decodeRedisJson<Message>\(result\[1\]\)/);
  assert.doesNotMatch(source, /message:\s*JSON\.parse\(result\[1\]\)/);
});


test("signup email verification is enforced by both OTP APIs and registration", () => {
  const send = read("src/app/api/auth/email-otp/route.ts");
  const verify = read("src/app/api/auth/email-otp/verify/route.ts");
  const register = read("src/app/api/auth/register/route.ts");
  const signup = read("src/components/signup/index.tsx");

  assert.match(send, /randomInt\(0, 1_000_000\)/);
  assert.match(send, /randomBytes\(32\)/);
  assert.match(send, /otp-cooldown/);
  assert.match(send, /runtime = "nodejs"/);
  assert.match(send, /maxDuration = 20/);
  assert.match(send, /isEmailConfigured\(\)/);
  assert.match(send, /sendEmail\(/);
  assert.match(send, /SMTP delivery failed/);
  assert.match(read("src/lib/email.ts"), /nodemailer\.createTransport/);
  assert.match(read("src/lib/email.ts"), /smtp\.gmail\.com/);
  assert.match(read("src/lib/email.ts"), /connectionTimeout/);
  assert.match(read("src/lib/email.ts"), /socketTimeout/);
  assert.match(send, /failed to clear send cooldown/);
  assert.match(send, /rateLimit\(/);
  assert.match(send, /ex:\s*600/);
  assert.match(verify, /timingSafeEqual/);
  assert.match(verify, /storedChallenge/);
  assert.match(verify, /attempts\s*>=\s*5/);
  assert.match(verify, /signup:verified:/);
  assert.match(register, /signup:verified:/);
  assert.match(register, /Please verify your email address/);
  assert.match(register, /emailVerificationToken/);
  assert.match(signup, /signup-otp/);
  assert.match(signup, /autoComplete="one-time-code"/);
  assert.match(signup, /verifyEmailOtp\(next\)/);
  assert.match(signup, /Resend in/);
  assert.match(signup, /!emailVerified/);
  assert.match(signup, /emailVerificationToken/);
});

test("chat viewport owns message scrolling and keeps composer outside the scroll region", () => {
  const layout = read("src/components/dashboardLayout/index.tsx");
  const chat = read("src/components/Chat/index.tsx");
  const messages = read("src/components/Chat/Messages.tsx");
  const input = read("src/components/Chat/ChatInput.tsx");

  assert.match(layout, /h-\[100dvh\].*overflow-hidden/);
  assert.match(layout, /h-full min-h-0 min-w-0.*overflow-y-auto overscroll-contain/);
  assert.match(chat, /min-h-0 min-w-0 flex-1 flex-col h-full max-h-full overflow-hidden/);
  assert.match(chat, /<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>[\s\S]*<Messages[\s\S]*<\/div>[\s\S]*<ChatInput/);
  assert.match(messages, /overflow-y-auto overscroll-contain/);
  assert.match(input, /shrink-0 border-t/);
});


test("staging Redis keyspace prefix covers direct commands, Lua keys, pipelines, and REST reads", () => {
  const namespace = read("src/lib/redis-keyspace.ts");
  const client = read("src/lib/db.ts");
  const rest = read("src/helpers/redis.ts");
  const example = read(".env.example");

  assert.match(namespace, /REDIS_KEY_PREFIX/);
  assert.match(namespace, /prefixRedisKey/);
  assert.match(namespace, /method === "eval"/);
  assert.match(namespace, /namespaceRedisPipeline/);
  assert.match(client, /prefixRedisCommandArgs/);
  assert.match(client, /namespaceRedisPipeline/);
  assert.match(rest, /prefixRedisCommandArgs/);
  assert.match(example, /REDIS_KEY_PREFIX=staging:/);
  assert.match(example, /Leave UNSET in production/);
});

test("AI image generation is authenticated, quota-limited, and uses the configured NVIDIA endpoint", () => {
  const route = read("src/app/api/ai/images/route.ts");
  const ui = read("src/components/ai/AIChat.tsx");
  assert.match(route, /getServerSession\(authOptions\)/);
  assert.match(route, /rateLimit\(session\.user\.id,\s*"ai-image-generation"/);
  assert.match(route, /AI_IMAGE_GENERATION_ENABLED/);
  assert.match(route, /https:\/\/ai\.api\.nvidia\.com\/v1\/cosmos\/nvidia\/cosmos3-nano/);
  assert.match(route, /model_mode:\s*"text2image"/);
  assert.match(route, /MAX_IMAGE_BYTES/);
  assert.match(ui, /fetch\("\/api\/ai\/images"/);
  assert.match(ui, /download="chatplus-generated-image\.jpg"/);
});

test("AI PDF export is authenticated, bounded, quota-limited, and returns a private PDF attachment", () => {
  const route = read("src/app/api/ai/pdf/route.ts");
  const ui = read("src/components/ai/AIChat.tsx");
  assert.match(route, /getServerSession\(authOptions\)/);
  assert.match(route, /rateLimit\(session\.user\.id,\s*"ai-pdf-export"/);
  assert.match(route, /AI_PDF_EXPORT_ENABLED/);
  assert.match(route, /application\/pdf/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /private, no-store/);
  assert.match(route, /3_700_000/);
  assert.match(route, /createPdf\(body\.messages\)/);
  assert.match(ui, /fetch\("\/api\/ai\/pdf"/);
  assert.match(ui, /Export PDF/);
  assert.match(ui, /URL\.createObjectURL/);
  assert.doesNotMatch(ui, /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/);
});

test("AI PDF export embeds validated generated JPEGs and bounds image payloads", () => {
  const route = read("src/app/api/ai/pdf/route.ts");
  const ui = read("src/components/ai/AIChat.tsx");
  assert.match(route, /MAX_IMAGE_BYTES/);
  assert.match(route, /data:image/);
  assert.match(route, /readJpegDimensions/);
  assert.match(route, /DCTDecode/);
  assert.match(route, /Subtype/);
  assert.match(route, /imageCount <= 2/);
  assert.match(ui, /imageData/);
});

test("AI PDF export preserves Unicode and loads script-aware fonts on demand", () => {
  const route = read("src/app/api/ai/pdf/route.ts");
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.engines.node, ">=22.0.0");
  assert.equal(manifest.dependencies.pdfnative, "1.9.0");
  assert.match(route, /registerFonts\\(FONT_LOADERS\\)/);
  assert.match(route, /loadFontData\\(lang\\)/);
  assert.match(route, /noto-devanagari-data/);
  assert.match(route, /noto-bengali-data/);
  assert.match(route, /noto-gujarati-data/);
  assert.match(route, /noto-gurmukhi-data/);
  assert.match(route, /noto-tamil-data/);
  assert.match(route, /noto-telugu-data/);
  assert.match(route, /noto-kannada-data/);
  assert.match(route, /noto-malayalam-data/);
  assert.match(route, /noto-arabic-data/);
  assert.match(route, /noto-hebrew-data/);
  assert.match(route, /noto-thai-data/);
  assert.match(route, /noto-lao-data/);
  assert.match(route, /noto-khmer-data/);
  assert.match(route, /noto-myanmar-data/);
  assert.match(route, /noto-tibetan-data/);
  assert.match(route, /noto-jp-data/);
  assert.match(route, /noto-sc-data/);
  assert.match(route, /noto-kr-data/);
  assert.match(route, /noto-greek-data/);
  assert.match(route, /noto-cyrillic-data/);
  assert.match(route, /noto-sans-data/);
  assert.doesNotMatch(route, /normalize\\("NFKD"\\)/);
  assert.doesNotMatch(route, /\\[\\^\\x20-\\x7E\\]/);
});
