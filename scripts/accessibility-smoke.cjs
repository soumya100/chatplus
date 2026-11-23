const assert = require("node:assert/strict");

const PLAYWRIGHT_PIN = "1.65.1";
let playwright;
let axe;
try {
  playwright = require("playwright");
  axe = require("axe-core");
} catch (error) {
  throw new Error(
    "Accessibility smoke requires the pinned global Playwright and axe-core packages. " +
    "Install with: npm install --global playwright@" + PLAYWRIGHT_PIN + " axe-core@4.10.3"
  );
}

const baseUrl = (process.env.CHATAPP_SMOKE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function auditPage(page, label) {
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(async tags => window.axe.run(document, {
    runOnly: { type: "tag", values: tags },
  }), wcagTags);

  if (results.violations.length) {
    const summary = results.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 8).map(node => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    }));
    console.error(label + " accessibility violations:\n" + JSON.stringify(summary, null, 2));
  }
  assert.equal(results.violations.length, 0, label + " must have no axe WCAG 2.2 AA/best-practice violations");
  console.log(label + ": " + results.passes.length + " accessibility rules passed; 0 violations.");
}

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl + "/login", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /welcome to chat\+/i }).waitFor();
    await auditPage(page, "Login");

    await page.goto(baseUrl + "/signup", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /create an account/i }).waitFor();
    await auditPage(page, "Signup");

    await page.locator("#signup-email").fill("a11y@example.test");
    await page.route("**/api/auth/email-otp", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ challengeToken: "b".repeat(64), message: "Code sent." }),
    }));
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByRole("dialog", { name: /verify your email/i }).waitFor();
    await auditPage(page, "Signup OTP dialog");

    assert.deepEqual(pageErrors, [], "Accessibility journeys must not trigger uncaught browser errors");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error("Accessibility audit failed:", error);
  process.exitCode = 1;
});
