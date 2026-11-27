const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Guard the @hookform/resolvers release used by GroupFeaturesPanel's poll and
// event forms. The panel imports the zod resolver subpath, so the pinned
// release must both resolve to 7.0.9 in the lockfile and keep exporting the
// zodResolver entry point that the component calls.
const root = path.resolve(__dirname, "..");

test("@hookform/resolvers resolves to 7.0.9 and still exports zodResolver", () => {
  const packageJson = require(path.join(root, "package.json"));
  const lockfile = fs.readFileSync(path.join(root, "yarn.lock"), "utf8");

  assert.equal(packageJson.dependencies["@hookform/resolvers"], "^7.0.9");

  assert.match(
    lockfile,
    /^"@hookform\/resolvers@\^7\.0\.9":\n  version "7\.0\.9"/m
  );
  assert.match(lockfile, /resolvers-7\.0\.9\.tgz/);
  assert.equal(lockfile.includes("resolvers-7.0.8.tgz"), false);

  const { zodResolver } = require("@hookform/resolvers/zod");
  assert.equal(typeof zodResolver, "function");
});
