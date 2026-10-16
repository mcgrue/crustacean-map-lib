import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { npm, retainedDirectory, root, run } from "./validation-common.mjs";

// Include intentional new work before its commit; ignore caches and sibling checkouts.
const names = run(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { capture: true },
)
  .split("\0")
  .filter(Boolean);
const checkout = retainedDirectory("clean-checkout");
console.log(`Clean-checkout Node runtime: ${process.version}`);
for (const name of names) {
  const target = path.join(checkout, name);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(root, name), target);
}
const env = { ...process.env };
delete env.FARMSVILLE_CONTENT_ROOT;
delete env.NODE_PATH;
env.npm_config_cache = path.join(checkout, ".npm-cache");
env.GIT_TERMINAL_PROMPT = "0";
// A public HTTPS install must work without SSH keys or an SSH fallback.
const configCount = Number(env.GIT_CONFIG_COUNT || 0);
env[`GIT_CONFIG_KEY_${configCount}`] = "protocol.ssh.allow";
env[`GIT_CONFIG_VALUE_${configCount}`] = "never";
env.GIT_CONFIG_COUNT = String(configCount + 1);
const lock = JSON.parse(
  readFileSync(path.join(checkout, "package-lock.json"), "utf8"),
);
assert.match(
  lock.packages["node_modules/crustacean-sprite-lib"].resolved,
  /^git\+https:\/\/github\.com\/mcgrue\/crustacean-sprite-lib\.git#[a-f0-9]{40}$/,
);
for (const [name, dependency] of Object.entries(lock.packages)) {
  assert.ok(
    !name.startsWith("..") && !name.includes(".deno"),
    `Host-local lock entry: ${name}`,
  );
  assert.ok(!dependency.link, `Linked dependency: ${name}`);
}
npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: checkout,
  env,
});
npm(["run", "check:dist"], { cwd: checkout, env });
npm(["test"], { cwd: checkout, env });
npm(["run", "test:package"], { cwd: checkout, env });
console.log(
  `Clean checkout and installed tarball validated without sibling repositories: ${checkout}`,
);
