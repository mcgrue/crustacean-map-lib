import type {
  MapAsset,
  MapCamera,
  MapEntity,
  MapLayer,
  MapPick,
  MapRect,
  Point,
  XY,
  TilesetDefinition,
} from "./types.js";

export function tileSize(
  asset: MapAsset,
  layer?: MapLayer,
): { width: number; height: number } {
  return (
    (layer && asset.tilesets[layer.vsp || "default"]?.definition.tilesize) ||
    asset.map.tile_size ||
    asset.tilesets.default?.definition.tilesize ||
    asset.tilesets[asset.map.layers[0]?.vsp || "default"]?.definition
      .tilesize || { width: 16, height: 16 }
  );
}
export function dimensions(asset: MapAsset): XY {
  return (
    asset.map.dimensions || {
      X: Math.max(0, ...asset.map.layers.map((l) => l.dimensions.X)),
      Y: Math.max(0, ...asset.map.layers.map((l) => l.dimensions.Y)),
    }
  );
}
export function bounds(asset: MapAsset): MapRect {
  const size = tileSize(asset),
    d = dimensions(asset);
  let x = 0,
    y = 0,
    right = asset.map.dimensions ? d.X * size.width : 0,
    bottom = asset.map.dimensions ? d.Y * size.height : 0;
  for (const l of asset.map.layers) {
    const s = tileSize(asset, l),
      ox = l.offset?.X || 0,
      oy = l.offset?.Y || 0;
    x = Math.min(x, ox);
    y = Math.min(y, oy);
    right = Math.max(right, ox + l.dimensions.X * s.width);
    bottom = Math.max(bottom, oy + l.dimensions.Y * s.height);
  }
  return { x, y, width: right - x, height: bottom - y };
}
export function screenToWorld(p: Point, camera: MapCamera): Point {
  return { x: p.x / camera.zoom + camera.x, y: p.y / camera.zoom + camera.y };
}
export function worldToScreen(p: Point, camera: MapCamera): Point {
  return {
    x: (p.x - camera.x) * camera.zoom,
    y: (p.y - camera.y) * camera.zoom,
  };
}
export function entityPosition(asset: MapAsset, e: MapEntity): Point {
  const s = tileSize(asset);
  return {
    x: e.location.px ?? (e.location.tx || 0) * s.width,
    y: e.location.py ?? (e.location.ty || 0) * s.height,
  };
}
export function entityBounds(asset: MapAsset, e: MapEntity): MapRect {
  const p = entityPosition(asset, e),
    d = asset.sprites[e.filename]?.definition;
  return {
    x: p.x - (d?.hitbox.x || 0),
    y: p.y - (d?.hitbox.y || 0),
    width: d?.width || 16,
    height: d?.height || 16,
  };
}
export function pickMap(
  asset: MapAsset,
  p: Point,
  camera?: MapCamera,
  layerIndex = 0,
): MapPick {
  const world = camera ? screenToWorld(p, camera) : p,
    l = asset.map.layers[layerIndex],
    s = tileSize(asset, l);
  // Pixel coordinates refer to a layer's transformed surface, including parallax.
  const lx = camera
    ? p.x / camera.zoom + camera.x * (l?.parallax?.X ?? 1)
    : world.x;
  const ly = camera
    ? p.y / camera.zoom + camera.y * (l?.parallax?.Y ?? 1)
    : world.y;
  const tx = Math.floor((lx - (l?.offset?.X || 0)) / s.width),
    ty = Math.floor((ly - (l?.offset?.Y || 0)) / s.height);
  const valid =
    l && tx >= 0 && ty >= 0 && tx < l.dimensions.X && ty < l.dimensions.Y;
  const result: MapPick = {
    worldX: world.x,
    worldY: world.y,
    tileX: tx,
    tileY: ty,
    layerIndex,
    tile: valid
      ? asset.data.tile_data[layerIndex]?.[ty * l.dimensions.X + tx] || 0
      : 0,
  };
  // Hit testing follows the same layer/parallax transform as entity drawing.
  for (let i = asset.map.entities.length - 1; i >= 0; i--) {
    const e = asset.map.entities[i],
      el = asset.map.layers.find((a) => a.name === e.location.layer),
      b = entityBounds(asset, e);
    const ex = camera
      ? p.x / camera.zoom +
        camera.x * (el?.parallax?.X ?? 1) -
        (el?.offset?.X || 0)
      : world.x;
    const ey = camera
      ? p.y / camera.zoom +
        camera.y * (el?.parallax?.Y ?? 1) -
        (el?.offset?.Y || 0)
      : world.y;
    if (ex >= b.x && ey >= b.y && ex < b.x + b.width && ey < b.y + b.height) {
      result.entityIndex = i;
      break;
    }
  }
  const base = tileSize(asset),
    zx = Math.floor(world.x / base.width),
    zy = Math.floor(world.y / base.height);
  result.zone = asset.data.zone_data?.find((z) => z.x === zx && z.y === zy)?.z;
  return result;
}
/** Modes match the Sully runtime: 0 forward, 1 backward, 2 random, 3 ping pong. */
export function animatedTile(
  definition: TilesetDefinition,
  tile: number,
  timeMs: number,
): number {
  for (const a of definition.animations || []) {
    if (tile < a.start || tile > a.end) continue;
    const n = a.end - a.start + 1,
      t = a.delay > 0 ? Math.floor(Math.max(0, timeMs) / (a.delay * 10)) : 0;
    if (n <= 1) return a.start;
    if (a.mode === 4 || !a.delay) return tile;
    let head = t % n;
    if (a.mode === 1) head = (n - (t % n)) % n;
    if (a.mode === 2) {
      const h = Math.imul(t + 1, 1664525) + 1013904223;
      head = t === 0 ? 0 : (h >>> 0) % n;
    }
    if (a.mode === 3) {
      const step = t % (2 * n - 2);
      head = step < n ? step : 2 * n - 2 - step;
    }
    return a.start + ((head + tile - a.start) % n);
  }
  return tile;
}
export function serializeMap(asset: MapAsset): { map: string; data: string } {
  if (
    asset.map.format_version !== 2 &&
    (asset.map.obstruction_layers?.length || asset.data.obstruction_data)
  )
    throw new Error("Extended obstruction layers require format_version 2");
  return {
    map: JSON.stringify(asset.map, null, 2) + "\n",
    data: JSON.stringify(asset.data) + "\n",
  };
}
export function createEmptyMap(): MapAsset {
  return {
    map: {
      name: "Untitled Map",
      format_version: 2,
      tile_size: { width: 16, height: 16 },
      dimensions: { X: 32, Y: 24 },
      vsp: {},
      layers: [],
      entities: [],
      zones: [],
      renderstring: "E",
      obstruction_layers: [],
    },
    data: { tile_data: [], zone_data: [], obstruction_data: {} },
    tilesets: {},
    sprites: {},
    mapUrl: "",
    dataUrl: "",
    contentRootUrl: "",
    dependencies: [],
    diagnostics: [],
  };
}
