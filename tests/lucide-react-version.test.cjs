const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Guard the lucide-react release used by the chat UI. Version 1.81.0 adds the
// icons documented in the release notes and renames square-sigma to the new
// canonical SquareSigma export. The UI imports icon components directly, so
// the installed package must expose those exports for the build to resolve.
const root = path.resolve(__dirname, "..");

test("lucide-react resolves to 1.81.0 and exposes the 1.81.0 icons", () => {
  const packageJson = require(path.join(root, "package.json"));
  const lockfile = fs.readFileSync(path.join(root, "yarn.lock"), "utf8");

  assert.equal(packageJson.dependencies["lucide-react"], "^1.81.0");

  assert.match(
    lockfile,
    /^lucide-react@\^1\.81\.0:\n  version "1\.81\.0"/m
  );
  assert.match(lockfile, /lucide-react-1\.81\.0\.tgz/);
  assert.equal(lockfile.includes("lucide-react-0.316.0.tgz"), false);

  const icons = require("lucide-react");
  for (const name of [
    "Elevator",
    "SteeringWheel",
    "GlobeClock",
    "BowlChopsticks",
    "SquareSigma",
  ]) {
    assert.ok(icons[name], `lucide-react 1.81.0 must export ${name}`);
  }

  // Legacy aliases still used by the application must keep resolving.
  for (const name of ["Loader2", "Trash2", "Smile", "Music", "AlertCircle"]) {
    assert.ok(icons[name], `lucide-react must keep the ${name} export`);
  }
});
