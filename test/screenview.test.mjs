import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyMap,
  layerCamera,
  layerToScreen,
  screenToLayer,
  pickMap,
  tileSize,
} from "../dist/mod.js";

for (const parallax of [0, 0.5, 1, 2]) {
  test(`preview transform matches the donor pivot and inverts at parallax ${parallax}`, () => {
    const layer = {
      offset: { X: -7, Y: 13 },
      parallax: { X: parallax, Y: parallax },
    };
    const camera = {
      x: 24,
      y: -16,
      zoom: 1.25,
      parallaxOrigin: { x: 80, y: 48 },
    };
    const local = { x: 29, y: 35 };
    // Donor viewport is camera-relative: p * (camera + viewport) - viewport.
    const vp = { x: 80 - camera.x, y: 48 - camera.y };
    const effective = {
      x: parallax * (camera.x + vp.x) - vp.x - layer.offset.X,
      y: parallax * (camera.y + vp.y) - vp.y - layer.offset.Y,
    };
    assert.deepEqual(layerCamera(camera, layer), effective);
    const point = layerToScreen(local, camera, layer);
    assert.deepEqual(point, {
      x: (local.x - effective.x) * 1.25,
      y: (local.y - effective.y) * 1.25,
    });
    assert.deepEqual(screenToLayer(point, camera, layer), local);
    const ordinary = { ...camera, parallaxOrigin: undefined };
    assert.deepEqual(layerCamera(ordinary, layer), {
      x: 24 * parallax + 7,
      y: -16 * parallax - 13,
    });
    const moved = { ...camera, x: camera.x + 12 };
    assert.equal(
      layerToScreen(local, moved, layer).x,
      point.x - 12 * camera.zoom,
    );
  });
}

test("preview picking agrees for non-square tiles and layer-attached entities; zones stay on the base plane", () => {
  const asset = createEmptyMap();
  asset.map.layers = [
    {
      name: "Back",
      dimensions: { X: 4, Y: 3 },
      vsp: "art",
      offset: { X: -8, Y: 12 },
      parallax: { X: 0.5, Y: 2 },
    },
  ];
  asset.tilesets.art = { definition: { tilesize: { width: 8, height: 16 } } };
  asset.data.tile_data = [[0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0]];
  asset.map.entities = [
    { filename: "npc", location: { layer: "Back", px: 16, py: 16 } },
  ];
  const camera = {
    x: -32,
    y: -64,
    zoom: 1.5,
    parallaxOrigin: { x: 48, y: 16 },
  };
  const point = layerToScreen({ x: 18, y: 20 }, camera, asset.map.layers[0]);
  const world = {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  };
  const base = tileSize(asset);
  asset.data.zone_data = [
    {
      x: Math.floor(world.x / base.width),
      y: Math.floor(world.y / base.height),
      z: 3,
    },
  ];
  const hit = pickMap(asset, point, camera);
  assert.equal(hit.tile, 7);
  assert.equal(hit.tileX, 2);
  assert.equal(hit.tileY, 1);
  assert.equal(hit.entityIndex, 0);
  assert.equal(hit.zone, 3);
});

test("base-plane positions ignore the preview origin and helpers never mutate camera or layers", () => {
  const camera = {
    x: -3,
    y: 7,
    zoom: 0.75,
    parallaxOrigin: { x: 120, y: -96 },
  };
  const layer = { offset: { X: 5, Y: -9 }, parallax: { X: 1, Y: 1 } };
  const before = JSON.stringify({ camera, layer });
  assert.deepEqual(layerToScreen({ x: 8, y: 13 }, camera), { x: 8.25, y: 4.5 });
  assert.deepEqual(layerCamera(camera, layer), { x: -8, y: 16 });
  assert.equal(JSON.stringify({ camera, layer }), before);
});
