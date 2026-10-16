import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  npm,
  packageJson,
  retainedDirectory,
  root,
  run,
} from "./validation-common.mjs";

const manifest = packageJson();
for (const hook of [
  "build",
  "prepare",
  "prepack",
  "preinstall",
  "install",
  "postinstall",
])
  assert.equal(
    manifest.scripts[hook],
    undefined,
    `${hook} would trigger an install-time Git dependency build`,
  );
assert.match(
  manifest.devDependencies["crustacean-sprite-lib"],
  /^git\+https:\/\/github\.com\/mcgrue\/crustacean-sprite-lib\.git#[a-f0-9]{40}$/,
);
const work = retainedDirectory("packed-consumer"),
  consumer = path.join(work, "consumer");
mkdirSync(consumer);
const packed = JSON.parse(
  npm(["pack", "--json", "--pack-destination", work], { capture: true }),
);
assert.equal(packed.length, 1);
const tarball = path.join(work, packed[0].filename);
for (const subpath of ["mod", "load", "webgl"])
  for (const extension of ["js", "d.ts"])
    assert.ok(
      packed[0].files.some(
        (file) => file.path === `dist/${subpath}.${extension}`,
      ),
    );
assert.ok(
  !packed[0].files.some(
    (file) =>
      file.path.startsWith("node_modules/") || file.path.startsWith(".build/"),
  ),
);
writeFileSync(
  path.join(consumer, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        "crustacean-map-lib": `file:${tarball}`,
        "crustacean-sprite-lib":
          manifest.devDependencies["crustacean-sprite-lib"],
      },
      devDependencies: { typescript: "4.6.4" },
    },
    null,
    2,
  ) + "\n",
);
npm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: consumer,
});
writeFileSync(
  path.join(consumer, "consumer.mjs"),
  `import assert from 'node:assert/strict';
import {createEmptyMap, serializeMap, loadMap} from 'crustacean-map-lib';
import {loadMap as loadEntry, resolveAssetUrl} from 'crustacean-map-lib/load';
import {WebGLMapRenderer} from 'crustacean-map-lib/webgl';
assert.equal(typeof globalThis.document, 'undefined');
assert.equal(typeof WebGLMapRenderer, 'function'); assert.equal(loadMap, loadEntry);
const asset = createEmptyMap(); assert.equal(JSON.parse(serializeMap(asset).map).format_version, 2);
assert.equal(resolveAssetUrl('D:\\\\Game\\\\map.map.json'), 'file:///D:/Game/map.map.json');
console.log('Installed tarball: ESM root/load/webgl imports pass without DOM globals.');
`,
);
run(process.execPath, ["consumer.mjs"], { cwd: consumer });
writeFileSync(
  path.join(consumer, "consumer.ts"),
  `import {createEmptyMap, MapAsset, MapCamera} from 'crustacean-map-lib';
import {loadMap} from 'crustacean-map-lib/load';
import {WebGLMapRenderer, MapRenderOptions} from 'crustacean-map-lib/webgl';
const asset: MapAsset = createEmptyMap(); const camera: MapCamera = {x:0,y:0,zoom:1};
const options: MapRenderOptions = {width:100,height:100,timeMs:0};
const renderer = new WebGLMapRenderer(document.createElement('canvas'));
void renderer.load(asset); renderer.render(camera,options); void loadMap;
`,
);
const compiler = path.join(consumer, "node_modules/typescript/lib/tsc.js");
assert.equal(
  JSON.parse(
    readFileSync(
      path.join(consumer, "node_modules/typescript/package.json"),
      "utf8",
    ),
  ).version,
  "4.6.4",
);
run(
  process.execPath,
  [
    compiler,
    "consumer.ts",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--target",
    "ES2020",
    "--module",
    "ES2020",
    "--moduleResolution",
    "node",
  ],
  { cwd: consumer },
);
console.log(
  `Installed tarball: TypeScript 4.6.4 root/load/webgl declarations pass (${tarball}).`,
);
