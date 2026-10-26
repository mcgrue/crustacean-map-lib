import type { SpriteDefinition } from "crustacean-sprite-lib";
export type { SpriteDefinition } from "crustacean-sprite-lib";
export interface XY {
  X: number;
  Y: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface MapCamera extends Point {
  zoom: number;
  /** World-space parallax pivot. Omit to use the camera's ordinary parallax. */
  parallaxOrigin?: Point;
}
export interface MapRect extends Point {
  width: number;
  height: number;
}
export interface MapLayer {
  name: string;
  dimensions: XY;
  vsp?: string;
  parallax?: XY;
  offset?: XY;
  alpha?: number;
  MAPED_HIDDEN?: boolean;
  maped_HIDE_ENTS?: boolean;
  [key: string]: any;
}
export interface ObstructionLayer extends MapLayer {
  id: string;
}
export interface MapEntity {
  name?: string;
  filename: string;
  animation?: string;
  location: {
    layer?: string;
    tx?: number | null;
    ty?: number | null;
    px?: number | null;
    py?: number | null;
    [key: string]: any;
  };
  [key: string]: any;
}
export interface MapDefinition {
  name?: string;
  format_version?: number;
  tile_size?: { width: number; height: number };
  dimensions?: XY;
  vsp: Record<string, string>;
  layers: MapLayer[];
  entities: MapEntity[];
  zones?: any[];
  renderstring: string;
  obstruction_layers?: ObstructionLayer[];
  tallentitylayer?: string | number | false;
  [key: string]: any;
}
export interface MapData {
  tile_data: number[][];
  legacy_obstruction_data?: number[];
  zone_data?: Array<{ x: number; y: number; z: number; [key: string]: any }>;
  obstruction_data?: Record<string, number[]>;
  [key: string]: any;
}
export interface TilesetAnimation {
  start: number;
  end: number;
  delay: number;
  mode: number;
  [key: string]: any;
}
export interface TilesetDefinition {
  tilesize: { width: number; height: number };
  tiles_per_row: number;
  source_image: string;
  animations?: TilesetAnimation[];
  [key: string]: any;
}
export interface TilesetAsset {
  definition: TilesetDefinition;
  definitionUrl: string;
  imageUrl: string;
}
export interface SpriteAsset {
  definition: SpriteDefinition;
  raw: any;
  definitionUrl: string;
  imageUrl: string;
  regions?: Record<string, number[]>;
}
export interface MapDiagnostic {
  message: string;
  url?: string;
  severity: "error" | "warning";
}
export interface MapAsset {
  map: MapDefinition;
  data: MapData;
  tilesets: Record<string, TilesetAsset>;
  sprites: Record<string, SpriteAsset>;
  mapUrl: string;
  dataUrl: string;
  contentRootUrl: string;
  dependencies: string[];
  diagnostics: MapDiagnostic[];
  /** Validated display defaults from adjacent $$$_MAPED.json; never serialized. */
  editorView?: {
    checkerColorA?: [number, number, number, number];
    checkerColorB?: [number, number, number, number];
  };
}
export interface LoadMapOptions {
  contentRootUrl?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}
export interface MapPick {
  worldX: number;
  worldY: number;
  tileX: number;
  tileY: number;
  layerIndex: number;
  tile: number;
  entityIndex?: number;
  zone?: number;
}
