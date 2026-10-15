import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { SpritePlayer } from "crustacean-sprite-lib";
import { loadMap, serializeMap } from "../dist/mod.js";

const root = process.env.FARMSVILLE_CONTENT_ROOT;
test(
  "complete Farmsville dependency closure and lossless round trip",
  { skip: !root },
  async () => {
    const rootUrl = pathToFileURL(path.resolve(root) + path.sep).href;
    const fetch = async (url, { signal } = {}) => {
      if (signal?.aborted) throw new Error("Aborted");
      try {
        return new Response(await readFile(new URL(url)), { status: 200 });
      } catch {
        return new Response("", { status: 404 });
      }
    };
    const mapUrl = new URL("maps/json/farmsville.map.json", rootUrl).href,
      a = await loadMap(mapUrl, { fetch });
    assert.equal(a.map.entities.length, 116);
    assert.equal(Object.keys(a.sprites).length, 50);
    assert.equal(Object.keys(a.tilesets).length, 2);
    assert.equal(a.data.tile_data.length, 7);
    assert.equal(a.diagnostics.filter((d) => d.severity === "error").length, 0);
    assert.equal(a.dependencies.length, 107);
    for (const dependency of a.dependencies)
      assert.ok((await stat(new URL(dependency))).size > 0, dependency);
    for (const sprite of Object.values(a.sprites))
      for (const key of Object.keys(sprite.definition.animations)) {
        const p = new SpritePlayer(sprite.definition, { animation: key });
        p.advance(10000);
        assert.ok(p.frame >= 0 && p.frame < sprite.definition.frames);
      }
    const serialized = serializeMap(a);
    assert.deepEqual(
      JSON.parse(serialized.map),
      JSON.parse(await readFile(new URL(mapUrl), "utf8")),
    );
    assert.deepEqual(
      JSON.parse(serialized.data),
      JSON.parse(await readFile(new URL(a.dataUrl), "utf8")),
    );
  },
);
