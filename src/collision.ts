import { animatedTile, dimensions } from './core.js';
import type { MapAsset, ObstructionLayer, Point } from './types.js';

/** Decoded RGBA pixels. No Canvas or WebGL dependency. */
export interface PixelMask {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}
export type PixelSampler = (imageUrl: string, x: number, y: number) => boolean;

/** Legacy magenta and black are empty; non-black, non-magenta opaque pixels obstruct. */
export function obstructionPixel(mask: PixelMask, x: number, y: number): boolean {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  const i = (y * mask.width + x) * 4, p = mask.data;
  return p[i + 3] > 0 && !(p[i] === 255 && p[i + 1] === 0 && p[i + 2] === 255) &&
    (p[i] > 0 || p[i + 1] > 0 || p[i + 2] > 0);
}

export function obstructionLayers(asset: MapAsset): readonly ObstructionLayer[] {
  return asset.map.format_version === 2 ? asset.map.obstruction_layers || [] : [{
    name: 'Obstructions', id: 'legacy', dimensions: dimensions(asset), vsp: 'obstructions',
    ...asset.map.obstructions_layer,
  }];
}

/** Union in world pixels, independent of camera, editor visibility, and drawing. */
export function sampleObstruction(asset: MapAsset, point: Point, timeMs: number, sample: PixelSampler): boolean {
  for (const layer of obstructionLayers(asset)) {
    const tileset = asset.tilesets[layer.vsp || 'obstructions'];
    if (!tileset) continue;
    const size = tileset.definition.tilesize;
    const x = Math.floor(point.x - (layer.offset?.X || 0));
    const y = Math.floor(point.y - (layer.offset?.Y || 0));
    const tx = Math.floor(x / size.width), ty = Math.floor(y / size.height);
    if (tx < 0 || ty < 0 || tx >= layer.dimensions.X || ty >= layer.dimensions.Y) continue;
    const data = asset.map.format_version === 2 ? asset.data.obstruction_data?.[layer.id] : asset.data.legacy_obstruction_data;
    const tile = data?.[ty * layer.dimensions.X + tx] || 0;
    if (!tile) continue;
    const id = animatedTile(tileset.definition, tile, timeMs), columns = tileset.definition.tiles_per_row;
    if (sample(tileset.imageUrl, (id % columns) * size.width + x % size.width,
      Math.floor(id / columns) * size.height + y % size.height)) return true;
  }
  return false;
}

/** Strict runtime validation: missing collision art must never become walkable space. */
export function validateCollisionMasks(asset: MapAsset, masks: ReadonlyMap<string, PixelMask>): void {
  for (const layer of obstructionLayers(asset)) {
    const data = asset.map.format_version === 2 ? asset.data.obstruction_data?.[layer.id] : asset.data.legacy_obstruction_data;
    if (!data && asset.map.format_version !== 2) continue;
    if (!data || data.length !== layer.dimensions.X * layer.dimensions.Y || data.some(v => !Number.isSafeInteger(v) || v < 0))
      throw new Error(`Invalid obstruction data: ${layer.id}`);
    if (!data.some(Boolean)) continue;
    const tileset = asset.tilesets[layer.vsp || 'obstructions'];
    const mask = tileset && masks.get(tileset.imageUrl);
    if (!tileset || !mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width <= 0 || mask.height <= 0 || mask.data.length !== mask.width * mask.height * 4)
      throw new Error(`Missing or invalid collision image: ${layer.id}`);
    const d = tileset.definition, s = d.tilesize;
    const valid = (id: number) => (id % d.tiles_per_row + 1) * s.width <= mask.width && (Math.floor(id / d.tiles_per_row) + 1) * s.height <= mask.height;
    if (data.some(id => !valid(id)) || d.animations?.some(a => !valid(a.start) || !valid(a.end)))
      throw new Error(`Collision tile outside atlas: ${layer.id}`);
  }
}
