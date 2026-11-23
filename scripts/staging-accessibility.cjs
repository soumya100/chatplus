const assert = require("node:assert/strict");

const { chromium } = require("playwright");
const axe = require("axe-core");
const baseUrl = (process.env.CHATAPP_STAGING_URL || "").replace(/\/$/, "");
const email = process.env.CHATAPP_TEST_SUPERADMIN_EMAIL;
const password = process.env.CHATAPP_TEST_SUPERADMIN_PASSWORD;
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function audit(page, label) {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async runTags => window.axe.run(document, {
    runOnly: { type: "tag", values: runTags },
  }), tags);
  if (result.violations.length) {
    console.error(label + " accessibility violations:\n" + JSON.stringify(result.violations.map(item => ({
      id: item.id, impact: item.impact, help: item.help,
      nodes: item.nodes.slice(0, 10).map(node => ({ target: node.target, summary: node.failureSummary })),
    })), null, 2));
  }
  assert.equal(result.violations.length, 0, label + " must pass WCAG 2.2 AA and axe best-practice rules");
  console.log(label + ": " + result.passes.length + " axe rules passed, 0 violations.");
}

async function login(page) {
  await page.goto(baseUrl + "/login", { waitUntil: "networkidle" });
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => url.pathname.startsWith("/dashboard"), { timeout: 30000 });
}

async function main() {
  assert.ok(baseUrl, "CHATAPP_STAGING_URL is required");
  assert.ok(email && password, "Dedicated SuperAdmin staging credentials are required");
  assert.equal(new URL(baseUrl).protocol, "https:", "Staging accessibility checks require HTTPS");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  try {
    await login(page);

    await page.goto(baseUrl + "/dashboard/communities", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Communities" }).waitFor();
    await audit(page, "Communities empty/list view (mobile)");
    const firstCommunity = page.locator("aside button").first();
    if (await firstCommunity.count()) {
      await firstCommunity.click();
      await page.getByRole("button", { name: "Announcements" }).click();
      await audit(page, "Community announcements (mobile)");
      await page.getByRole("button", { name: "Groups" }).click();
      await audit(page, "Community groups (mobile)");
      await page.getByRole("button", { name: "Members" }).click();
      await audit(page, "Community members (mobile)");
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(baseUrl + "/dashboard/superadmin", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /SuperAdmin control center/i }).waitFor();
    await audit(page, "SuperAdmin dashboard (desktop)");

    const overview = await page.evaluate(async () => {
      const response = await fetch("/api/superadmin/overview");
      return response.status;
    });
    assert.equal(overview, 200, "allowlisted SuperAdmin must access the protected platform overview");

    assert.deepEqual(pageErrors, [], "Authenticated admin screens must not throw uncaught browser errors");
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error("Authenticated staging accessibility audit failed:", error);
  process.exitCode = 1;
});
