import type { MapAsset, MapCamera, MapEntity, MapLayer, MapPick, MapRect, Point, XY, TilesetDefinition } from "./types.js";
export declare function tileSize(asset: MapAsset, layer?: MapLayer): {
    width: number;
    height: number;
};
export declare function dimensions(asset: MapAsset): XY;
export declare function bounds(asset: MapAsset): MapRect;
export declare function screenToWorld(p: Point, camera: MapCamera): Point;
export declare function worldToScreen(p: Point, camera: MapCamera): Point;
export declare function entityPosition(asset: MapAsset, e: MapEntity): Point;
export declare function entityBounds(asset: MapAsset, e: MapEntity): MapRect;
export declare function pickMap(asset: MapAsset, p: Point, camera?: MapCamera, layerIndex?: number): MapPick;
/** Modes match the Sully runtime: 0 forward, 1 backward, 2 random, 3 ping pong. */
export declare function animatedTile(definition: TilesetDefinition, tile: number, timeMs: number): number;
export declare function serializeMap(asset: MapAsset): {
    map: string;
    data: string;
};
export declare function createEmptyMap(): MapAsset;
