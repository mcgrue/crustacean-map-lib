import type { MapAsset, ObstructionLayer, Point } from './types.js';
/** Decoded RGBA pixels. No Canvas or WebGL dependency. */
export interface PixelMask {
    readonly width: number;
    readonly height: number;
    readonly data: ArrayLike<number>;
}
export declare type PixelSampler = (imageUrl: string, x: number, y: number) => boolean;
/** Legacy magenta and black are empty; non-black, non-magenta opaque pixels obstruct. */
export declare function obstructionPixel(mask: PixelMask, x: number, y: number): boolean;
export declare function obstructionLayers(asset: MapAsset): readonly ObstructionLayer[];
/** Union in world pixels, independent of camera, editor visibility, and drawing. */
export declare function sampleObstruction(asset: MapAsset, point: Point, timeMs: number, sample: PixelSampler): boolean;
/** Strict runtime validation: missing collision art must never become walkable space. */
export declare function validateCollisionMasks(asset: MapAsset, masks: ReadonlyMap<string, PixelMask>): void;
