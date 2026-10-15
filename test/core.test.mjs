import test from "node:test";
import assert from "node:assert/strict";
import { SpritePlayer } from "crustacean-sprite-lib";
import {
  adaptLegacySprite,
  animatedTile,
  bounds,
  createEmptyMap,
  entityPosition,
  loadMap,
  pickMap,
  resolveAssetUrl,
  screenToWorld,
  serializeMap,
  validateMap,
  worldToScreen,
} from "../dist/mod.js";

const sprite = () => ({
  dims: [8, 16],
  hitbox: [0, 8, 8, 8],
  frames: 3,
  per_row: 3,
  inner_pad: 0,
  outer_pad: 0,
  image: "npc.png",
  animations: { Walk: ["T15 0 1 2", "Looping"], Still: [0, "Static"] },
});
const map = () => ({
  name: "Fixture",
  vsp: { art: "art.vsp.json", obstructions: "obs.vsp.json" },
  layers: [
    {
      name: "Ground",
      vsp: "art",
      dimensions: { X: 3, Y: 2 },
      offset: { X: -8, Y: 16 },
      parallax: { X: 0.5, Y: 1 },
    },
  ],
  renderstring: "1,E",
  entities: [
    {
      filename: "chrs/npc.json",
      animation: "Walk",
      location: { layer: "Entity Layer (E)", px: 0, py: 0, tx: 2, ty: 3 },
    },
  ],
  zones: [null, { name: "Door" }],
  custom: { preserve: true },
});
const data = () => ({
  tile_data: [
    [1, 2, 3, 0, 1, 0],
    [7, 8, 9],
  ],
  legacy_obstruction_data: [0, 1, 0, 0, 0, 0],
  zone_data: [{ x: 1, y: 1, z: 1 }],
  extra: [1, 2],
});
const vsp = () => ({
  tilesize: { width: 8, height: 16 },
  tiles_per_row: 4,
  source_image: "tiles.png",
  animations: [{ start: 1, end: 3, delay: 15, mode: 0 }],
});
function fixtureFiles() {
  return new Map([
    ["https://fixture.test/game/maps/demo.map.json", map()],
    ["https://fixture.test/game/maps/demo.map.data.json", data()],
    ["https://fixture.test/game/maps/$$$_MAPED.json", { path_to_chrs: "../" }],
    ["https://fixture.test/game/maps/art.vsp.json", vsp()],
    ["https://fixture.test/game/maps/obs.vsp.json", vsp()],
    ["https://fixture.test/game/chrs/npc.json", sprite()],
  ]);
}
const fetcher =
  (files) =>
  async (url, { signal } = {}) => {
    if (signal?.aborted) {
      const e = new Error("Aborted");
      e.name = "AbortError";
      throw e;
    }
    return files.has(url)
      ? new Response(JSON.stringify(files.get(url)), { status: 200 })
      : new Response("", { status: 404 });
  };
async function fixture() {
  return loadMap("https://fixture.test/game/maps/demo.map.json", {
    fetch: fetcher(fixtureFiles()),
  });
}

test("portable loader resolves companion/config/tileset/sprite/image dependency graph", async () => {
  const a = await fixture();
  assert.equal(a.contentRootUrl, "https://fixture.test/game/");
  assert.equal(
    a.sprites["chrs/npc.json"].imageUrl,
    "https://fixture.test/game/chrs/npc.png",
  );
  assert.equal(
    a.tilesets.art.imageUrl,
    "https://fixture.test/game/maps/tiles.png",
  );
  assert.equal(a.dependencies.length, 8);
  assert.ok(
    a.dependencies.includes("https://fixture.test/game/maps/$$$_MAPED.json"),
  );
  assert.equal(
    a.sprites["chrs/npc.json"].definition.animations.Walk.instructions[0]
      .delayMs,
    150,
  );
  assert.ok(a.diagnostics.some((d) => d.message.includes("surplus")));
});
test("serialization preserves sparse zones, unknown metadata and surplus tile arrays exactly", async () => {
  const a = await fixture(),
    s = serializeMap(a);
  assert.deepEqual(JSON.parse(s.map), map());
  assert.deepEqual(JSON.parse(s.data), data());
  assert.equal(a.map.format_version, undefined);
});
test("explicit content root takes priority, map-relative root takes priority over config", async () => {
  const files = fixtureFiles(),
    m = files.get("https://fixture.test/game/maps/demo.map.json");
  m.MAPED_CONTENT_ROOT = "../";
  files.set("https://fixture.test/game/maps/$$$_MAPED.json", {
    path_to_chrs: "/wrong/",
  });
  let a = await loadMap("https://fixture.test/game/maps/demo.map.json", {
    fetch: fetcher(files),
  });
  assert.equal(a.contentRootUrl, "https://fixture.test/game/");
  assert.ok(!a.dependencies.some((p) => p.includes("MAPED.json")));
  files.set("https://fixture.test/explicit/chrs/npc.json", sprite());
  a = await loadMap("https://fixture.test/game/maps/demo.map.json", {
    contentRootUrl: "https://fixture.test/explicit",
    fetch: fetcher(files),
  });
  assert.equal(a.contentRootUrl, "https://fixture.test/explicit/");
  assert.equal(
    a.sprites["chrs/npc.json"].definitionUrl,
    "https://fixture.test/explicit/chrs/npc.json",
  );
});
test("legacy project-relative ~/ images and spaces resolve against content root", async () => {
  const files = fixtureFiles();
  files.get("https://fixture.test/game/chrs/npc.json").image =
    "~/images/Some NPC.png";
  const a = await loadMap("https://fixture.test/game/maps/demo.map.json", {
    fetch: fetcher(files),
  });
  assert.equal(
    a.sprites["chrs/npc.json"].imageUrl,
    "https://fixture.test/game/images/Some%20NPC.png",
  );
});
test("Windows drive, UNC and backslash relative references become valid file URLs", () => {
  assert.equal(
    resolveAssetUrl("D:\\Content Root\\maps\\demo.map.json"),
    "file:///D:/Content%20Root/maps/demo.map.json",
  );
  assert.equal(
    resolveAssetUrl(
      "..\\images\\Some NPC.png",
      "file:///D:/Content/maps/demo.json",
    ),
    "file:///D:/Content/images/Some%20NPC.png",
  );
  assert.equal(
    resolveAssetUrl("\\\\server\\share\\image.png"),
    "file://server/share/image.png",
  );
});
test("missing sprite preserves entity source and yields a specific diagnostic", async () => {
  const files = fixtureFiles();
  files.delete("https://fixture.test/game/chrs/npc.json");
  const a = await loadMap("https://fixture.test/game/maps/demo.map.json", {
    fetch: fetcher(files),
  });
  assert.equal(a.map.entities.length, 1);
  assert.ok(a.dependencies.includes("https://fixture.test/game/chrs/npc.json"));
  assert.equal(a.diagnostics.filter((d) => d.severity === "error").length, 1);
  assert.equal(
    a.diagnostics.find((d) => d.severity === "error").url,
    "https://fixture.test/game/chrs/npc.json",
  );
});
test("cancellation rejects rather than returning partial data", async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    loadMap("https://fixture.test/game/maps/demo.map.json", {
      fetch: fetcher(fixtureFiles()),
      signal: c.signal,
    }),
    { name: "AbortError" },
  );
});
test("structurally malformed and unknown version map formats reject", () => {
  const m = map();
  m.layers[0].dimensions.X = -1;
  assert.throws(() => validateMap(m, data()), /positive integer/);
  m.layers[0].dimensions.X = 3;
  m.format_version = 99;
  assert.throws(() => validateMap(m, data()), /Unsupported/);
});
test("legacy sprite adapter preserves zero hitboxes and raw timing", () => {
  const raw = sprite();
  raw.hitbox = [0, 0, 0, 0];
  raw.regions = { Tall_Redraw: [0, 0, 8, 8] };
  const d = adaptLegacySprite(raw),
    p = new SpritePlayer(d, { animation: "Walk" });
  assert.equal(d.hitbox.width, 0);
  assert.equal(d.hitbox.height, 0);
  assert.equal(raw.animations.Walk[0], "T15 0 1 2");
  assert.equal(raw.version, undefined);
  p.advance(149);
  assert.equal(p.frame, 0);
  p.advance(1);
  assert.equal(p.frame, 1);
  assert.deepEqual(raw.regions.Tall_Redraw, [0, 0, 8, 8]);
});
test("versioned sprite timing remains milliseconds", () => {
  const raw = { ...sprite(), version: 1 };
  const d = adaptLegacySprite(raw);
  assert.equal(d.animations.Walk.instructions[0].delayMs, 15);
});
test("legacy explicit-pair and random durations convert to milliseconds", () => {
  const raw = sprite();
  raw.animations = {
    Walk: [
      [
        [0, 10],
        [1, 20],
      ],
      "Looping",
    ],
    Random: [15, [0, 1, 2], "Random"],
  };
  const d = adaptLegacySprite(raw);
  assert.deepEqual(
    d.animations.Walk.instructions.map((i) => i.delayMs),
    [100, 200],
  );
  assert.equal(d.animations.Random.instructions[0].delayMs, 150);
});
test("world transforms, layer offsets/parallax, and exact zero entity coordinates", async () => {
  const a = await fixture(),
    camera = { x: 16, y: 32, zoom: 2 };
  assert.deepEqual(screenToWorld({ x: 20, y: 40 }, camera), { x: 26, y: 52 });
  assert.deepEqual(worldToScreen({ x: 26, y: 52 }, camera), { x: 20, y: 40 });
  assert.deepEqual(entityPosition(a, a.map.entities[0]), { x: 0, y: 0 });
  assert.deepEqual(bounds(a), { x: -8, y: 0, width: 24, height: 48 });
  const p = pickMap(a, { x: 0, y: 0 }, camera, 0);
  assert.equal(p.tileX, 2);
  assert.equal(p.tileY, 1);
  assert.equal(p.tile, 0);
});
test("entity tile coordinates use the map grid independently of the assigned art layer", async () => {
  const a = await fixture();
  a.map.tile_size = { width: 32, height: 24 };
  a.map.entities[0].location = { layer: "Ground", tx: 2, ty: 3 };
  assert.deepEqual(entityPosition(a, a.map.entities[0]), { x: 64, y: 72 });
});
test("tile animations match runtime forward, reverse, ping pong, random and disabled modes", () => {
  const a = vsp(),
    head = (time) => animatedTile(a, 1, time);
  assert.deepEqual([0, 149, 150, 300, 450].map(head), [1, 1, 2, 3, 1]);
  assert.equal(animatedTile(a, 2, 150), 3);
  a.animations[0].mode = 1;
  assert.deepEqual([0, 150, 300, 450].map(head), [1, 3, 2, 1]);
  a.animations[0].mode = 3;
  assert.deepEqual([0, 150, 300, 450, 600].map(head), [1, 2, 3, 2, 1]);
  a.animations[0].mode = 2;
  assert.equal(head(0), 1);
  assert.equal(head(150), head(150));
  assert.ok(head(150) >= 1 && head(150) <= 3);
  a.animations[0].mode = 4;
  assert.equal(animatedTile(a, 2, 150), 2);
  a.animations[0].mode = 0;
  a.animations[0].delay = 0;
  assert.equal(animatedTile(a, 2, 1000), 2);
});
test("extended map can have no art, explicit dimensions, and keyed obstruction arrays", () => {
  const a = createEmptyMap();
  a.map.obstruction_layers = [
    {
      id: "walls",
      name: "Walls",
      vsp: "obstructions",
      dimensions: { X: 2, Y: 2 },
      offset: { X: 8, Y: 0 },
    },
  ];
  a.data.obstruction_data = { walls: [1, 0, 0, 2] };
  validateMap(a.map, a.data);
  assert.equal(bounds(a).width, 512);
  const s = serializeMap(a);
  assert.equal(JSON.parse(s.map).format_version, 2);
  assert.deepEqual(JSON.parse(s.data).obstruction_data.walls, [1, 0, 0, 2]);
  a.map.format_version = undefined;
  assert.throws(() => serializeMap(a), /format_version 2/);
});
