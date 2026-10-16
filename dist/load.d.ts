import type { SpriteDefinition } from "crustacean-sprite-lib";
import type { LoadMapOptions, MapAsset, MapData, MapDefinition } from "./types.js";
/** Resolve portable URL paths, Windows drive paths, UNC paths, and legacy backslashes. */
export declare function resolveAssetUrl(reference: string, base?: string): string;
export declare function validateMap(map: MapDefinition, data: MapData): void;
/** Normalize legacy timing and zero hitboxes in memory; never rewrites its source. */
export declare function adaptLegacySprite(raw: any): SpriteDefinition;
export declare function loadMap(url: string, options?: LoadMapOptions): Promise<MapAsset>;
