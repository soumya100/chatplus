const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("root and dashboard failures render accessible retry boundaries", () => {
  for (const file of ["src/app/error.tsx", "src/app/global-error.tsx", "src/app/(dashboard)/dashboard/error.tsx"]) {
    const source = read(file);
    assert.match(source, /role="alert"/, file + " must announce the failure");
    assert.match(source, /onClick=\{\(\)\s*=>\s*reset\(\)\}/, file + " must expose a retry action");
    assert.match(source, /focus-visible:outline/, file + " retry must be keyboard-visible");
  }
});

test("chat send failures retain the draft and expose retryable failed messages", () => {
  const composer = read("src/components/Chat/ChatInput.tsx");
  const chat = read("src/components/Chat/index.tsx");
  assert.match(composer, /catch \(error: any\)/);
  assert.match(composer, /toast\.error/);
  assert.match(chat, /status: 'error'/);
  assert.match(chat, /handleRetryMessage/);
});

test("offline delivery has a bounded durable queue and reports unavailable browser storage", () => {
  const queue = read("src/lib/offline-message-queue.ts");
  assert.match(queue, /typeof indexedDB === "undefined"/);
  assert.match(queue, /Offline storage is unavailable/);
  assert.match(queue, /MAX_QUEUED_MESSAGES_PER_CHAT = 200/);
  assert.match(queue, /Unable to save offline message/);
  assert.match(queue, /Unable to read offline messages/);
});

test("media upload failures are bounded and explain supported file types", () => {
  const media = read("src/lib/mediaUpload.ts");
  assert.match(media, /file\.size > maxUploadSize/);
  assert.match(media, /This file format is not supported/);
  assert.match(media, /const blob = await upload/);
});

test("OTP send and verification failures return controlled client-facing messages", () => {
  const signup = read("src/components/signup/index.tsx");
  assert.match(signup, /Unable to send verification code/);
  assert.match(signup, /Verification failed/);
  assert.match(signup, /Unable to connect to the server/);
  assert.match(signup, /role="alert"/);
});
