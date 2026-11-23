const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Playwright is intentionally NOT a package.json dependency: it would pull the
// multi-hundred-megabyte browser download into every yarn install. CI installs
// the pinned global build instead (see chatapp-ci.yml, "Install pinned
// Playwright and browser engines"). The version here must match that pin.
const PLAYWRIGHT_PIN = "1.65.1";
let playwright;
try {
  playwright = require("playwright");
} catch {
  throw new Error(
    `Playwright is required by the browser smoke test but is not installed. ` +
    `Install the pinned build: npm install --global playwright@${PLAYWRIGHT_PIN} ` +
    `&& playwright install chromium firefox webkit`
  );
}
const { chromium, firefox, webkit } = playwright;

const baseUrl = (process.env.CHATAPP_SMOKE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const engines = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
].filter(([name]) =>
  !process.env.CHATAPP_SMOKE_ENGINES ||
  process.env.CHATAPP_SMOKE_ENGINES.split(",").includes(name)
);

async function togglePasswordVisibility(page, selector, reveal, engine) {
  // React hydrates after the first paint, and a click delivered before
  // hydration completes is silently dropped (notably against a cold dev
  // server that is still compiling the page). The toggle is therefore
  // asserted through a bounded retry loop instead of a single racy click.
  const label = reveal ? "Show password" : "Hide password";
  const expectedType = reveal ? "text" : "password";
  const expectedAction = reveal ? "reveal" : "hide";
  const deadline = Date.now() + 20_000;
  let lastType = "";
  while (Date.now() < deadline) {
    await page.getByRole("button", { name: label }).click();
    try {
      await page.waitForFunction(
        ([inputSelector, type]) => document.querySelector(inputSelector)?.getAttribute("type") === type,
        [selector, expectedType],
        { timeout: 2_000 }
      );
      return;
    } catch {
      lastType = await page.locator(selector).getAttribute("type");
    }
  }
  assert.equal(lastType, expectedType, `${engine}: password visibility should ${expectedAction} the input`);
}

// React controlled inputs wipe DOM values that were set before hydration
// completed (the re-render that finishes hydration resets them from state),
// and fills delivered into a not-yet-attached field can append instead of
// replacing. Each field is therefore filled and verified in a bounded loop:
// once React has hydrated, a fill sticks and the loop converates on the first
// pass; anything delivered too early is simply re-filled afterwards.
const SIGNUP_FIELDS = [
  { selector: '#signup-name', value: "Smoke Test", label: "name" },
  { selector: '#signup-email', value: "smoke@example.test", label: "email" },
];

async function fillSignupField(page, selector, value, label) {
  const deadline = Date.now() + 30_000;
  let lastError = "";
  for (;;) {
    const field = page.locator(selector);
    if (await field.inputValue() !== value) await field.fill(value);
    try {
      await page.waitForFunction(
        ([expr, expected]) => {
          const el = document.querySelector(expr);
          return el && el.value === expected;
        },
        [selector, value],
        { timeout: 2_000 }
      );
      return;
    } catch (error) {
      lastError = error.message;
    }
    if (Date.now() > deadline) {
      throw new Error(`${label}: could not set the field value (it kept being reset by hydration): ${lastError}`);
    }
  }
}

async function submitSignupExpecting(page, engine, password, confirmation, expectedText, pageErrors, failedRequests) {
  // React hydrates after the first paint, and a Create Account click
  // delivered before hydration completes falls through to a native form
  // submission that reloads the page and clears every field. Clicking again
  // immediately would keep reloading the page before it ever hydrates, so
  // every attempt waits for the page to settle (network idle plus a grace
  // period) before interacting, and the submission is retried within a
  // bounded window.
  const deadline = Date.now() + 90_000;
  let lastError = "";
  for (;;) {
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    for (const { selector, value, label } of SIGNUP_FIELDS) {
      await fillSignupField(page, selector, value, label);
    }
    await fillSignupField(page, '#signup-password', password, "password");
    await fillSignupField(page, '#signup-confirm-password', confirmation, "confirm");
    await page.getByRole("button", { name: "Create Account" }).click();
    try {
      await page.getByText(expectedText).waitFor({ timeout: 5_000 });
      return;
    } catch (error) {
      lastError = error.message;
      const state = await page.evaluate(() => ({
        url: location.href,
        values: [...document.querySelectorAll("input")].map(i => `${i.getAttribute("placeholder") || i.type}=${JSON.stringify(i.value.slice(0, 12))}`).join(" | "),
        visibleErrors: [...document.querySelectorAll("span")].map(s => s.textContent).filter(t => t && (t.includes("match") || t.includes("satisfy"))).slice(0, 2),
      }));
      console.warn(`${engine}: attempt failed: ${lastError.split("\n")[0]} :: ${state.url} :: ${state.values} :: errors=${JSON.stringify(state.visibleErrors)} :: pageErrors=${JSON.stringify(pageErrors.slice(0, 3))} :: failedRequests=${JSON.stringify(failedRequests.slice(0, 3))}`);
    }
    if (Date.now() > deadline) break;
  }
  assert.fail(`${engine}: signup validation message "${expectedText}" never appeared: ${lastError}`);
}

// Chromium's password manager captures the credentials of any password form
// on submit and silently restores them into the fields for roughly a minute
// afterwards, which overwrites values the test just typed: a weak-password
// submission poisons the mismatch assertion that follows it (the restored
// weak password fails the strength check again, so the expected message
// never renders). Running Chromium from a persistent user-data dir with the
// password manager and autofill disabled in Preferences removes the
// capture/restore mechanism entirely; Firefox and WebKit have no such
// in-session restore and keep the plain launch.
async function launchSmokeContext(browserType, name) {
  const viewport = { width: 390, height: 844 };
  if (name !== "chromium") {
    const browser = await browserType.launch({ headless: true, args: [] });
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    return { page, close: () => browser.close() };
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatapp-smoke-chromium-"));
  fs.mkdirSync(path.join(userDataDir, "Default"), { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "Default", "Preferences"),
    JSON.stringify({
      credentials_enable_service: false,
      credentials_enable_service_next_passwords_enabled: false,
      password_manager_enabled: false,
      autofill: { profile_enabled: false, credit_card_enabled: false },
    })
  );
  const context = await browserType.launchPersistentContext(userDataDir, {
    headless: true,
    args: ["--no-sandbox"],
    viewport,
    deviceScaleFactor: 1,
  });
  const page = context.pages()[0] || (await context.newPage());
  return { page, close: () => context.close() };
}

async function exerciseBrowser(name, browserType) {
  const { page, close } = await launchSmokeContext(browserType, name);
  const pageErrors = [];
  const failedRequests = [];
  const requestFrameUrls = new WeakMap();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (request.resourceType() !== "script") return;
    try {
      requestFrameUrls.set(request, request.frame().url());
    } catch {
      // Detached frames are still checked as failed requests below.
    }
  });
  page.on("requestfailed", request => {
    const errorText = request.failure()?.errorText || "failed";
    const requestUrl = request.url();
    let supersededByNavigation = false;
    const startedOnUrl = requestFrameUrls.get(request);
    if (startedOnUrl) {
      try {
        supersededByNavigation = request.frame().url() !== startedOnUrl;
      } catch {
        supersededByNavigation = true;
      }
    }
    // Next.js may cancel an in-flight RSC fetch or a script chunk belonging
    // to the previous document when a later navigation supersedes it.
    // Ignore only those GET cancellations; failed resources on the current
    // page and every other network error remain visible to the assertion.
    const expectedNavigationAbort =
      errorText === "net::ERR_ABORTED" &&
      request.method() === "GET" &&
      (new URL(requestUrl).searchParams.has("_rsc") ||
        (request.resourceType() === "script" && supersededByNavigation));
    if (!expectedNavigationAbort) {
      failedRequests.push(`${request.method()} ${requestUrl}: ${errorText}`);
    }
  });

  try {
    await page.route("**/api/auth/email-otp", async route => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ challengeToken: "a".repeat(64), message: "Code sent for browser smoke." }) });
    });
    await page.route("**/api/auth/email-otp/verify", async route => {
      const request = route.request();
      const payload = request.postDataJSON();
      await route.fulfill({ status: payload?.code === "123456" ? 200 : 400, contentType: "application/json", body: JSON.stringify(payload?.code === "123456" ? { verified: true } : { message: "Invalid code." }) });
    });
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /welcome to chat\+/i }).waitFor();
    await page.locator('input[type="email"]').waitFor({ state: "visible" });
    const passwordSelector = 'input[autocomplete="current-password"]';
    await page.locator(passwordSelector).waitFor({ state: "visible" });
    await togglePasswordVisibility(page, passwordSelector, true, name);
    await togglePasswordVisibility(page, passwordSelector, false, name);

    await page.goto(`${baseUrl}/forgot-password`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /forgot your password/i }).waitFor();
    await page.locator("#reset-request-email").waitFor({ state: "visible" });
    await page.goto(`${baseUrl}/reset-password?token=invalid&email=smoke%40example.test`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /choose a new password/i }).waitFor();

    const loginWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(loginWidth <= 391, `${name}: login page overflows mobile viewport: ${loginWidth}px`);

    await page.goto(`${baseUrl}/signup`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /create an account/i }).waitFor();
    await page.locator("#signup-name").fill("Smoke Test");
    await page.locator("#signup-email").fill("smoke@example.test");
    await page.locator("#signup-password").fill("Abcdef12!");
    await page.locator("#signup-confirm-password").fill("Abcdef12!");
    await page.getByRole("button", { name: "Create Account" }).click();
    await page.getByText(/verify your email address using the OTP/i).waitFor();
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByRole("dialog", { name: /verify your email/i }).waitFor();
    await page.locator("#signup-otp").fill("123456");
    await page.getByText("Email verified").waitFor();
    await submitSignupExpecting(
      page, name,
      "abc", "abc",
      /password does not satisfy the security requirements/i,
      pageErrors, failedRequests
    );
    await submitSignupExpecting(
      page, name,
      "Abcdef12!", "Different12!",
      "Passwords do not match.",
      pageErrors, failedRequests
    );

    const signupWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(signupWidth <= 391, `${name}: signup page overflows mobile viewport: ${signupWidth}px`);

    // Exercise narrow phones and tablet width as well as the default mobile
    // viewport; horizontal overflow is a frequent accessibility failure.
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: width < 400 ? 740 : 1024 });
      await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /welcome to chat\+/i }).waitFor();
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(documentWidth <= width, `${name}: login page overflows ${width}px viewport: ${documentWidth}px`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    const desktopHeading = page.getByRole("heading", { name: /welcome to chat\+/i });
    await desktopHeading.waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await desktopHeading.isVisible(), true, `${name}: login heading should be visible on desktop`);

    assert.deepEqual(pageErrors, [], `${name}: no uncaught browser errors should occur during authentication journeys`);
    assert.deepEqual(failedRequests, [], `${name}: no network requests should fail during authentication journeys`);
    console.log(`${name}: login, password toggle, signup validation, responsive viewports passed`);
  } finally {
    await close();
  }
}

(async () => {
  for (const [name, browserType] of engines) await exerciseBrowser(name, browserType);
  console.log("Cross-browser smoke passed on Chromium, Firefox and WebKit.");
})().catch(error => {
  console.error("Cross-browser smoke failed:", error);
  process.exitCode = 1;
});
