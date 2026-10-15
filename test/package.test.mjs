import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

test("ESM root imports in Node without browser globals", async () => {
  const module = await import("../dist/mod.js");
  assert.equal(typeof module.loadMap, "function");
  assert.equal(typeof module.createEmptyMap, "function");
});
test("TypeScript 4.6 consumer resolves root and webgl subpath declarations", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "crustacean-map-consumer-"));
  mkdirSync(path.join(dir, "node_modules"));
  symlinkSync(
    path.resolve(fileURLToPath(new URL("..", import.meta.url))),
    path.join(dir, "node_modules", "crustacean-map-lib"),
    "junction",
  );
  const filename = path.join(dir, "consumer.ts");
  writeFileSync(
    filename,
    `import {createEmptyMap, loadMap, MapAsset, MapCamera, pickMap} from 'crustacean-map-lib';
import {WebGLMapRenderer, MapRenderOptions} from 'crustacean-map-lib/webgl';
import {resolveAssetUrl} from 'crustacean-map-lib/load';
const asset: MapAsset = createEmptyMap(); const camera: MapCamera = {x: 0, y: 0, zoom: 1};
const renderer = new WebGLMapRenderer(document.createElement('canvas'));
const options: MapRenderOptions = {width: 200, height: 200, timeMs: 0};
void renderer.load(asset); renderer.render(camera, options); renderer.pick({x: 0, y: 0}, camera); void loadMap; void pickMap; void resolveAssetUrl;
`,
  );
  const program = ts.createProgram([filename], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    ),
    [],
  );
});
