import type { MapAsset, MapCamera, MapPick, Point } from "./types.js";
export interface MapRenderOptions {
    width: number;
    height: number;
    timeMs: number;
    pixelRatio?: number;
    showObstructions?: boolean;
    showZones?: boolean;
    showEntities?: boolean;
    showBounds?: boolean;
    showHitboxes?: boolean;
    showCanopies?: boolean;
    hiddenLayers?: ReadonlySet<number> | readonly number[];
    screenview?: {
        enabled: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
        opacity?: number;
    };
    checker?: {
        size?: number;
        colorA?: readonly number[];
        colorB?: readonly number[];
    };
}
export interface RendererStats {
    tileUploads: number;
    tilePixelsUploaded: number;
    imageUploads: number;
    animationUploads: number;
    drawCalls: number;
}
/** WebGL 2 renderer. Coordinates and width/height are CSS pixels; camera is world pixels. */
export declare class WebGLMapRenderer {
    readonly canvas: HTMLCanvasElement;
    readonly stats: RendererStats;
    private gl;
    private tileProgram;
    private spriteProgram;
    private solidProgram;
    private vao;
    private asset?;
    private images;
    private atlases;
    private tiles;
    private dirty;
    private players;
    private time;
    private generation;
    private lost;
    private disposed;
    private restoring?;
    private controller?;
    private uniforms;
    private fallbackImage;
    private fallbackIndex;
    private hitDraws;
    private parallaxOrigin?;
    private pixels;
    private lostHandler;
    private restoreHandler;
    constructor(canvas: HTMLCanvasElement);
    private initialize;
    private uniform;
    private texture;
    load(asset: MapAsset, options?: {
        signal?: AbortSignal;
    }): Promise<void>;
    private resetPlayers;
    /** Call after model changes. An omitted index invalidates art, zones, and obstruction tiles. */
    invalidate(layerIndex?: number): void;
    private tileTexture;
    private quad;
    private draw;
    private solid;
    private updateAnimations;
    private drawLayer;
    private drawEntity;
    render(camera: MapCamera, options: MapRenderOptions): void;
    private opaque;
    /** Pick actual visible pixels in draw order. smart=true also chooses the top art layer. */
    pick(point: Point, camera: MapCamera, layerIndex?: number, options?: {
        smart?: boolean;
    }): MapPick;
    /** Collision masks combine by union, independently of overlay visibility. */
    isObstructed(point: Point): boolean;
    private drawObstructions;
    private zoneValues;
    private drawZones;
    restore(): Promise<void>;
    private clearResources;
    dispose(): void;
}
