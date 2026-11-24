const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const nodemailer = require("nodemailer");
const h = require("./helpers/group-api-harness.cjs");

const otpRoute = h.loadRoute("src/app/api/auth/email-otp/route.ts");
const email = "otp-recipient@example.test";
const emailKey = createHash("sha256").update(email).digest("hex");
const cooldownKey = `signup:otp-cooldown:${emailKey}`;
const otpKey = `signup:otp:${emailKey}`;
const originalCreateTransport = nodemailer.createTransport;
const originalSet = h.db.set;
const originalDel = h.db.del;
const originalEval = h.db.eval;
const originalError = console.error;

let transportBehavior;
let sentMessages;
let logs;

function configure() {
  h.reset();
  process.env.SMTP_USER = "chatplus@example.test";
  process.env.SMTP_PASS = "test-app-password";
  process.env.SMTP_HOST = "smtp.gmail.com";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_SECURE = "true";
  process.env.EMAIL_FROM = "Chat+ <chatplus@example.test>";
  process.env.NEXTAUTH_SECRET = "test-nextauth-secret";

  sentMessages = [];
  logs = [];
  transportBehavior = async message => {
    sentMessages.push(message);
    return { messageId: "smtp-test-message" };
  };

  // Keep this route-level test deterministic and independent of a live Redis
  // or SMTP service while exercising the real route and shared email module.
  h.db.eval = async () => [1, 1];
  h.db.set = async (key, value, options) => {
    if (options?.nx && h.getKv(key) !== null) return null;
    return originalSet.call(h.db, key, value);
  };
  h.db.del = async key => originalDel.call(h.db, key);
  nodemailer.createTransport = () => ({
    sendMail: message => transportBehavior(message),
    close() {},
  });
  console.error = (...args) => logs.push(args);
}

function restore() {
  nodemailer.createTransport = originalCreateTransport;
  h.db.set = originalSet;
  h.db.del = originalDel;
  h.db.eval = originalEval;
  console.error = originalError;
}

async function postOtp() {
  return otpRoute.POST(h.request({ email }));
}

async function responseData(response) {
  return { status: response.status, body: await response.json() };
}

test("signup OTP: sends email, persists only the OTP hash and returns the challenge", async () => {
  configure();
  try {
    const result = await responseData(await postOtp());
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.match(result.body.challengeToken, /^[a-f0-9]{64}$/);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].to, email);
    assert.match(sentMessages[0].subject, /verification code/i);

    const code = sentMessages[0].html.match(/>(\d{6})<\/div>/)?.[1];
    assert.ok(code, "email contains a six-digit OTP");
    const stored = JSON.parse(h.getKv(otpKey));
    const expectedHash = createHash("sha256")
      .update(`${email}:${code}:${process.env.NEXTAUTH_SECRET}`)
      .digest("hex");
    assert.equal(stored.hash, expectedHash);
    assert.equal(stored.challengeToken, result.body.challengeToken);
    assert.equal(stored.attempts, 0);
    assert.equal(await h.db.ttl(otpKey) > 0, true);
    assert.ok(h.getKv(cooldownKey), "successful delivery retains the cooldown");
  } finally {
    restore();
  }
});

test("signup OTP: SMTP authentication failure returns a generic error and clears cooldown", async () => {
  configure();
  try {
    transportBehavior = async () => {
      const error = new Error("authentication failed for secret-recipient");
      Object.assign(error, { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" });
      throw error;
    };
    const result = await responseData(await postOtp());
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { message: "We couldn't send the verification email. Please try again shortly." });
    assert.equal(h.getKv(cooldownKey), null);
    assert.equal(h.getKv(otpKey), null);
    assert.doesNotMatch(JSON.stringify(result.body), /secret-recipient|EAUTH|535/i);
    assert.doesNotMatch(JSON.stringify(logs), /secret-recipient|test-app-password|\d{6}|[a-f0-9]{64}/i);
    assert.ok(logs.some(([label, metadata]) =>
      label === "[email-otp] SMTP delivery failed" &&
      metadata.code === "EAUTH" && metadata.responseCode === 535
    ));
  } finally {
    restore();
  }
});

for (const failure of [
  { name: "SMTP timeout", code: "ETIMEDOUT", command: "CONN" },
  { name: "SMTP connection failure", code: "ECONNECTION", command: "CONN" },
]) {
  test(`signup OTP: ${failure.name} returns a generic error and clears cooldown`, async () => {
    configure();
    try {
      transportBehavior = async () => {
        const error = new Error("private transport diagnostic");
        Object.assign(error, failure);
        throw error;
      };
      const result = await responseData(await postOtp());
      assert.equal(result.status, 502);
      assert.equal(h.getKv(cooldownKey), null);
      assert.equal(h.getKv(otpKey), null);
      assert.doesNotMatch(JSON.stringify(result.body), /private transport diagnostic|ETIMEDOUT|ECONNECTION/);
      assert.doesNotMatch(JSON.stringify(logs), /private transport diagnostic|test-app-password|\d{6}|[a-f0-9]{64}/i);
      assert.ok(logs.some(([label, metadata]) =>
        label === "[email-otp] SMTP delivery failed" && metadata.code === failure.code
      ));
    } finally {
      restore();
    }
  });
}

test("signup OTP: Redis OTP persistence failure clears cooldown and never returns the challenge", async () => {
  configure();
  try {
    const originalChallengeSet = h.db.set;
    h.db.set = async (key, value, options) => {
      if (key === otpKey) throw new Error("redis persistence diagnostic");
      if (options?.nx && h.getKv(key) !== null) return null;
      return originalChallengeSet.call(h.db, key, value);
    };

    const result = await responseData(await postOtp());
    assert.equal(sentMessages.length, 1, "SMTP delivery completed before OTP persistence failed");
    assert.equal(result.status, 502);
    assert.deepEqual(result.body, { message: "We couldn't send the verification email. Please try again shortly." });
    assert.equal(h.getKv(otpKey), null);
    assert.equal(h.getKv(cooldownKey), null);
    assert.doesNotMatch(JSON.stringify(result.body), /redis persistence diagnostic|challengeToken|[a-f0-9]{64}/i);
    assert.doesNotMatch(JSON.stringify(logs), /redis persistence diagnostic|test-app-password|\d{6}|[a-f0-9]{64}/i);
  } finally {
    restore();
  }
});

test("signup OTP: SMTP failure never leaks OTP or challenge token in logs or response", async () => {
  configure();
  try {
    transportBehavior = async () => {
      const error = new Error("provider rejected message");
      Object.assign(error, { code: "EENVELOPE", responseCode: 550, command: "RCPT TO" });
      throw error;
    };
    const result = await responseData(await postOtp());
    assert.equal(result.status, 502);
    const combined = JSON.stringify({ response: result.body, logs });
    assert.doesNotMatch(combined, /\b\d{6}\b|[a-f0-9]{64}|challengeToken|otp-recipient@example\.test|test-app-password/i);
  } finally {
    restore();
  }
});
