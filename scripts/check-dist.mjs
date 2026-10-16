import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { files, retainedDirectory, root, run } from "./validation-common.mjs";

const fresh = retainedDirectory("fresh-dist");
run(process.execPath, [
  path.join(root, "node_modules/typescript/lib/tsc.js"),
  "-p",
  path.join(root, "tsconfig.json"),
  "--outDir",
  fresh,
]);
const expected = files(fresh),
  actual = files(path.join(root, "dist"));
assert.deepEqual(
  actual,
  expected,
  "dist/ contains missing or unexpected distribution files. Run npm run build:dist and review dist/.",
);
for (const file of expected)
  assert.ok(
    readFileSync(path.join(fresh, file)).equals(
      readFileSync(path.join(root, "dist", file)),
    ),
    `Stale dist/${file}. Run npm run build:dist and commit the generated distribution.`,
  );
console.log(
  `Distribution matches a fresh TypeScript build: ${expected.length} files.`,
);
