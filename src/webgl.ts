import { SpritePlayer, frameRect, validateAtlas } from "crustacean-sprite-lib";
import {
  animatedTile,
  dimensions,
  entityBounds,
  entityPosition,
  pickMap,
  layerCamera,
  layerToScreen,
  screenToLayer,
  tileSize,
} from "./core.js";
import type {
  MapAsset,
  MapCamera,
  MapEntity,
  MapLayer,
  MapPick,
  MapRect,
  Point,
  TilesetAsset,
} from "./types.js";

export interface MapRenderOptions {
  width: number;
  height: number;
  timeMs: number;
  pixelRatio?: number;
  showObstructions?: boolean;
  showZones?: boolean;
  /** Zone fill opacity, clamped to 0..1; defaults to 0.35. */
  zoneOpacity?: number;
  /** Opt-in non-color identification; zero remains empty. */
  showZoneIds?: boolean;
  zonePatterns?: boolean;
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
interface ImageTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  source: HTMLImageElement;
}
interface TileTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  values?: Uint32Array;
}
interface AtlasTexture {
  image: ImageTexture;
  animation: WebGLTexture;
  size: number;
  height: number;
  values: Uint32Array;
  last: string;
  asset: TilesetAsset;
}
interface PlayerEntry {
  player: SpritePlayer;
  entity: MapEntity;
  seed: number;
}
type HitDraw =
  | { kind: "tile"; layer: MapLayer; data: readonly number[]; index: number }
  | { kind: "entity"; entry: PlayerEntry; layer?: MapLayer; clipMode: number };

const vertex = `#version 300 es
precision highp float;
out vec2 v_uv;
uniform vec4 u_rect;
uniform vec2 u_viewport;
void main(){
  vec2 p=vec2((gl_VertexID==1||gl_VertexID==2||gl_VertexID==4)?1.:0.,(gl_VertexID==2||gl_VertexID==4||gl_VertexID==5)?1.:0.);
  v_uv=p;vec2 screen=u_rect.xy+p*u_rect.zw;
  gl_Position=vec4(screen.x/u_viewport.x*2.-1.,1.-screen.y/u_viewport.y*2.,0.,1.);
}`;
const tileFragment = `#version 300 es
precision highp float;
precision highp usampler2D;
in vec2 v_uv;out vec4 color;
uniform sampler2D u_image;
uniform usampler2D u_tiles;uniform usampler2D u_animation;
uniform vec2 u_camera;uniform vec2 u_worldSize;uniform vec2 u_tileSize;
uniform ivec2 u_dimensions;uniform int u_perRow;uniform int u_animWidth;
uniform float u_opacity;uniform int u_mode;
uniform bool u_zoneIds;uniform bool u_zonePatterns;uniform float u_zoom;
// Small bitmap digits keep IDs crisp without a font/atlas dependency.
const uint digits[10]=uint[10](31599u,29850u,29671u,31207u,18925u,31183u,31695u,18727u,31727u,31215u);
vec3 zoneColor(uint id,vec2 local){
  float h=float(id)*2.399963;
  vec3 fill=vec3(.45+.45*sin(h),.5+.4*sin(h+2.),.55+.4*sin(h+4.));
  if(u_zonePatterns){
    vec2 pixel=floor(local);
    float spacing=4.+float((id/4u)%3u);
    uint kind=id%4u;
    float stripe=kind==0u?pixel.x+pixel.y:kind==1u?pixel.x-pixel.y:kind==2u?pixel.y:pixel.x;
    if(mod(stripe,spacing)<1.)fill=mix(fill,vec3(.04),.55);
  }
  if(!u_zoneIds)return fill;
  int count=1;uint value=id;
  for(int i=0;i<9;i++){value/=10u;if(value==0u)break;count++;}
  vec2 size=vec2(float(count*4-1),5.);
  vec2 cell=u_tileSize*u_zoom;
  float scale=floor(min(3.,min(cell.x/(size.x+4.),cell.y/9.)));
  if(scale<1.)return fill;
  vec2 p=floor((local-(cell-size*scale)*.5)/scale);
  if(any(lessThan(p,vec2(-1.)))||any(greaterThanEqual(p,size+1.)))return fill;
  // A dark plate provides contrast over both light and dark artwork.
  if(p.y<0.||p.y>=5.||p.x<0.||p.x>=size.x)return vec3(.02);
  int index=int(p.x)/4;int column=int(p.x)%4;
  uint divisor=1u;
  for(int i=0;i<9;i++){if(i>=count-index-1)break;divisor*=10u;}
  uint digit=(id/divisor)%10u;
  bool ink=column<3&&(digits[int(digit)]&(1u<<uint(int(p.y)*3+column)))!=0u;
  return ink?vec3(1.):vec3(.02);
}
void main(){
  vec2 world=u_camera+v_uv*u_worldSize;
  ivec2 tile=ivec2(floor(world/u_tileSize));
  if(any(lessThan(tile,ivec2(0)))||any(greaterThanEqual(tile,u_dimensions)))discard;
  uint id=texelFetch(u_tiles,tile,0).r;
  if(id==0u)discard;
  if(u_mode==2){color=vec4(zoneColor(id,mod(world,u_tileSize)*u_zoom),u_opacity);return;}
  uint mapped=texelFetch(u_animation,ivec2(int(id)%u_animWidth,int(id)/u_animWidth),0).r;
  vec2 atlas=(vec2(int(mapped)%u_perRow,int(mapped)/u_perRow)*u_tileSize+mod(world,u_tileSize)+vec2(.0001))/vec2(textureSize(u_image,0));
  vec4 sampleColor=texture(u_image,atlas);
  if(sampleColor.a==0. || (sampleColor.r>.999&&sampleColor.g<.001&&sampleColor.b>.999))discard;
  if(u_mode==1){if(max(sampleColor.r,max(sampleColor.g,sampleColor.b))<.002)discard;color=vec4(1.,.2,.12,sampleColor.a*u_opacity);}
  else color=vec4(sampleColor.rgb,sampleColor.a*u_opacity);
}`;
const spriteFragment = `#version 300 es
precision highp float;
in vec2 v_uv;out vec4 color;
uniform sampler2D u_image;uniform vec4 u_source;uniform vec4 u_clip;
uniform int u_clipMode;uniform float u_opacity;
void main(){
  vec2 local=v_uv*u_source.zw;
  bool inside=all(greaterThanEqual(local,u_clip.xy))&&all(lessThan(local,u_clip.xy+u_clip.zw));
  if((u_clipMode==1&&inside)||(u_clipMode==2&&!inside))discard;
  vec4 s=texture(u_image,(u_source.xy+local)/vec2(textureSize(u_image,0)));
  if(s.a==0. || (s.r>.999&&s.g<.001&&s.b>.999))discard;
  color=vec4(s.rgb,s.a*u_opacity);
}`;
const solidFragment = `#version 300 es
precision highp float;
in vec2 v_uv;out vec4 color;
uniform vec4 u_color;uniform vec4 u_colorB;uniform vec2 u_size;uniform float u_line;uniform float u_checker;
void main(){
  if(u_checker>0.){float parity=mod(floor(v_uv.x*u_size.x/u_checker)+floor(v_uv.y*u_size.y/u_checker),2.);color=mix(u_color,u_colorB,parity);return;}
  if(u_line>0.){vec2 p=v_uv*u_size;if(p.x>u_line&&p.y>u_line&&p.x<u_size.x-u_line&&p.y<u_size.y-u_line)discard;}
  color=u_color;
}`;

function program(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error("Cannot create WebGL program");
  const shaders: WebGLShader[] = [];
  try {
    for (const [kind, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const s = gl.createShader(kind);
      if (!s) throw new Error("Cannot create shader");
      shaders.push(s);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(
          gl.getShaderInfoLog(s) || "Map shader compilation failed",
        );
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) || "Map shader link failed");
    return p;
  } catch (e) {
    gl.deleteProgram(p);
    throw e;
  } finally {
    for (const s of shaders) gl.deleteShader(s);
  }
}
function abortError(): Error {
  const e = new Error("Map load cancelled");
  e.name = "AbortError";
  return e;
}
async function decodeImage(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const objectUrl = URL.createObjectURL(await response.blob());
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      URL.revokeObjectURL(objectUrl);
      reject(abortError());
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", abort);
      URL.revokeObjectURL(objectUrl);
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(abortError());
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Could not decode map image: ${url}`));
    };
    signal?.addEventListener("abort", abort, { once: true });
    image.src = objectUrl;
  });
}

/** WebGL 2 renderer. Coordinates and width/height are CSS pixels; camera is world pixels. */
export class WebGLMapRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly stats: RendererStats = {
    tileUploads: 0,
    tilePixelsUploaded: 0,
    imageUploads: 0,
    animationUploads: 0,
    drawCalls: 0,
  };
  private gl: WebGL2RenderingContext;
  private tileProgram!: WebGLProgram;
  private spriteProgram!: WebGLProgram;
  private solidProgram!: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private asset?: MapAsset;
  private images = new Map<string, ImageTexture>();
  private atlases = new Map<string, AtlasTexture>();
  private tiles = new Map<string, TileTexture>();
  private dirty = new Set<string>();
  private players: PlayerEntry[] = [];
  private time = 0;
  private generation = 0;
  private lost = false;
  private disposed = false;
  private restoring?: Promise<void>;
  private controller?: AbortController;
  private uniforms = new Map<
    WebGLProgram,
    Map<string, WebGLUniformLocation | null>
  >();
  private fallbackImage!: WebGLTexture;
  private fallbackIndex!: WebGLTexture;
  private hitDraws: HitDraw[] = [];
  private parallaxOrigin?: Point;
  private pixels = new Map<string, ImageData>();
  private lostHandler = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };
  private restoreHandler = () => {
    void this.restore().catch((e) => {
      this.canvas.dispatchEvent(
        new CustomEvent("map-render-error", { detail: e }),
      );
    });
  };
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("Map rendering requires WebGL 2");
    this.gl = gl;
    this.initialize();
    canvas.addEventListener("webglcontextlost", this.lostHandler);
    canvas.addEventListener("webglcontextrestored", this.restoreHandler);
  }
  private initialize(): void {
    const gl = this.gl;
    this.tileProgram = program(gl, tileFragment);
    this.spriteProgram = program(gl, spriteFragment);
    this.solidProgram = program(gl, solidFragment);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.fallbackImage = this.texture();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    this.fallbackIndex = this.texture();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32UI,
      1,
      1,
      0,
      gl.RED_INTEGER,
      gl.UNSIGNED_INT,
      new Uint32Array([0]),
    );
  }
  private uniform(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    let cache = this.uniforms.get(p);
    if (!cache) {
      cache = new Map();
      this.uniforms.set(p, cache);
    }
    if (!cache.has(name)) cache.set(name, this.gl.getUniformLocation(p, name));
    return cache.get(name)!;
  }
  private texture(): WebGLTexture {
    const gl = this.gl,
      t = gl.createTexture();
    if (!t) throw new Error("Cannot allocate map texture");
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  async load(
    asset: MapAsset,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    if (this.disposed) throw new Error("Map renderer is disposed");
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const generation = ++this.generation;
    try {
      const urls = [
        ...new Set([
          ...Object.values(asset.tilesets).map((a) => a.imageUrl),
          ...Object.values(asset.sprites).map((a) => a.imageUrl),
        ]),
      ];
      const decoded = await Promise.all(
        urls.map(async (url) => ({
          url,
          source: await decodeImage(url, controller.signal),
        })),
      );
      if (
        generation !== this.generation ||
        this.disposed ||
        controller.signal.aborted
      )
        throw abortError();
      const gl = this.gl,
        max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const decodedByUrl = new Map(
        decoded.map((item) => [item.url, item.source]),
      );
      for (const { url, source } of decoded)
        if (source.naturalWidth > max || source.naturalHeight > max)
          throw new Error(`Map image exceeds GPU texture limit ${max}: ${url}`);
      for (const sprite of Object.values(asset.sprites)) {
        const image = decodedByUrl.get(sprite.imageUrl)!;
        try {
          validateAtlas(
            sprite.definition,
            image.naturalWidth,
            image.naturalHeight,
          );
        } catch (e) {
          const message = `${sprite.imageUrl}: ${
            e instanceof Error ? e.message : String(e)
          }`;
          if (sprite.raw.version !== undefined) throw new Error(message);
          if (!asset.diagnostics.some((d) => d.message === message))
            asset.diagnostics.push({
              severity: "warning",
              url: sprite.imageUrl,
              message,
            });
        }
      }
      for (const tileset of Object.values(asset.tilesets)) {
        const image = decodedByUrl.get(tileset.imageUrl)!;
        if (
          image.naturalWidth <
            tileset.definition.tiles_per_row *
              tileset.definition.tilesize.width ||
          image.naturalHeight < tileset.definition.tilesize.height
        )
          throw new Error(`Tiles do not fit map atlas: ${tileset.imageUrl}`);
      }
      this.clearResources();
      this.asset = asset;
      for (const { url, source } of decoded) {
        if (source.naturalWidth > max || source.naturalHeight > max)
          throw new Error(`Map image exceeds GPU texture limit ${max}: ${url}`);
        const texture = this.texture();
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          source,
        );
        this.stats.imageUploads++;
        this.images.set(url, {
          texture,
          width: source.naturalWidth,
          height: source.naturalHeight,
          source,
        });
      }
      for (const [key, a] of Object.entries(asset.tilesets)) {
        const image = this.images.get(a.imageUrl)!,
          count = Math.max(
            1,
            a.definition.tiles_per_row *
              Math.floor(image.height / a.definition.tilesize.height),
          );
        const size = Math.min(max, count),
          height = Math.ceil(count / size),
          values = new Uint32Array(size * height);
        for (let i = 0; i < values.length; i++) values[i] = i;
        const animation = this.texture();
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R32UI,
          size,
          height,
          0,
          gl.RED_INTEGER,
          gl.UNSIGNED_INT,
          values,
        );
        this.atlases.set(key, {
          image,
          animation,
          size,
          height,
          values,
          last: "",
          asset: a,
        });
      }
      this.resetPlayers();
      this.invalidate();
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }
  private resetPlayers(): void {
    this.time = 0;
    this.players = [];
    if (!this.asset) return;
    this.asset.map.entities.forEach((entity, index) => {
      const definition = this.asset!.sprites[entity.filename]?.definition;
      if (!definition) return;
      let seed = index + 1;
      const randomIndex = (count: number) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % count;
      };
      const animation =
        entity.animation && definition.animations[entity.animation]
          ? entity.animation
          : undefined;
      this.players.push({
        entity,
        seed: index,
        player: new SpritePlayer(definition, { animation, randomIndex }),
      });
    });
  }
  /** Call after model changes. An omitted index invalidates art, zones, and obstruction tiles. */
  invalidate(layerIndex?: number): void {
    if (layerIndex !== undefined) this.dirty.add(`art:${layerIndex}`);
    else {
      for (const key of this.tiles.keys()) this.dirty.add(key);
      this.asset?.map.layers.forEach((_, i) => this.dirty.add(`art:${i}`));
      this.dirty.add("zones");
      this.dirty.add("legacy-obstructions");
      for (const l of this.asset?.map.obstruction_layers || [])
        this.dirty.add(`obs:${l.id}`);
    }
  }
  private tileTexture(
    key: string,
    data: readonly number[],
    width: number,
    height: number,
  ): TileTexture {
    const gl = this.gl,
      max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (width > max || height > max)
      throw new Error(
        `Map grid ${width}x${height} exceeds GPU texture limit ${max}`,
      );
    let t = this.tiles.get(key);
    if (!t || t.width !== width || t.height !== height) {
      if (t) gl.deleteTexture(t.texture);
      t = { texture: this.texture(), width, height };
      this.tiles.set(key, t);
      this.dirty.add(key);
    }
    if (this.dirty.has(key)) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      if (!t.values) {
        t.values = new Uint32Array(width * height);
        for (let i = 0; i < Math.min(t.values.length, data.length); i++)
          t.values[i] = data[i] || 0;
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.R32UI,
          width,
          height,
          0,
          gl.RED_INTEGER,
          gl.UNSIGNED_INT,
          t.values,
        );
        this.stats.tileUploads++;
        this.stats.tilePixelsUploaded += t.values.length;
      } else {
        let minX = width,
          minY = height,
          maxX = -1,
          maxY = -1;
        for (let i = 0; i < t.values.length; i++) {
          const next = data[i] || 0;
          if (t.values[i] !== next) {
            t.values[i] = next;
            const x = i % width,
              y = Math.floor(i / width);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
        if (maxX >= minX) {
          const w = maxX - minX + 1,
            h = maxY - minY + 1,
            region = new Uint32Array(w * h);
          for (let y = 0; y < h; y++)
            region.set(
              t.values.subarray(
                (minY + y) * width + minX,
                (minY + y) * width + minX + w,
              ),
              y * w,
            );
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            minX,
            minY,
            w,
            h,
            gl.RED_INTEGER,
            gl.UNSIGNED_INT,
            region,
          );
          this.stats.tileUploads++;
          this.stats.tilePixelsUploaded += region.length;
        }
      }
      this.dirty.delete(key);
    }
    return t;
  }
  private quad(
    p: WebGLProgram,
    x: number,
    y: number,
    width: number,
    height: number,
    options: MapRenderOptions,
  ): void {
    const gl = this.gl;
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    gl.uniform4f(this.uniform(p, "u_rect"), x, y, width, height);
    gl.uniform2f(this.uniform(p, "u_viewport"), options.width, options.height);
  }
  private draw(): void {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
    this.stats.drawCalls++;
  }
  private solid(
    rect: MapRect,
    color: readonly number[],
    options: MapRenderOptions,
    line = 0,
    colorB?: readonly number[],
    checker = 0,
  ): void {
    const gl = this.gl,
      p = this.solidProgram;
    this.quad(p, rect.x, rect.y, rect.width, rect.height, options);
    gl.uniform4fv(this.uniform(p, "u_color"), new Float32Array(color));
    gl.uniform4fv(
      this.uniform(p, "u_colorB"),
      new Float32Array(colorB || color),
    );
    gl.uniform2f(this.uniform(p, "u_size"), rect.width, rect.height);
    gl.uniform1f(this.uniform(p, "u_line"), line);
    gl.uniform1f(this.uniform(p, "u_checker"), checker);
    this.draw();
  }
  private updateAnimations(timeMs: number): void {
    const gl = this.gl;
    for (const atlas of this.atlases.values()) {
      const animations = atlas.asset.definition.animations || [];
      const frames = animations.map((a) =>
        animatedTile(atlas.asset.definition, a.start, timeMs),
      );
      const signature = frames.join(",");
      if (signature === atlas.last) continue;
      atlas.last = signature;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, atlas.animation);
      animations.forEach((a, i) => {
        if (a.mode === 4) return;
        for (let start = a.start; start <= a.end; ) {
          const end = Math.min(
            a.end + 1,
            Math.floor(start / atlas.size + 1) * atlas.size,
            atlas.values.length,
          );
          if (end <= start) break;
          for (let index = start; index < end; index++)
            atlas.values[index] = animatedTile(
              atlas.asset.definition,
              index,
              timeMs,
            );
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            start % atlas.size,
            Math.floor(start / atlas.size),
            end - start,
            1,
            gl.RED_INTEGER,
            gl.UNSIGNED_INT,
            atlas.values.subarray(start, end),
          );
          this.stats.animationUploads++;
          start = end;
        }
      });
    }
  }
  private drawLayer(
    key: string,
    layer: MapLayer,
    data: readonly number[],
    camera: MapCamera,
    options: MapRenderOptions,
    mode = 0,
  ): void {
    const atlas = this.atlases.get(layer.vsp || "default");
    if (!atlas && mode !== 2) return;
    if (mode === 0)
      this.hitDraws.push({
        kind: "tile",
        layer,
        data,
        index: Number(key.slice(4)),
      });
    const gl = this.gl,
      p = this.tileProgram,
      s = mode === 2 ? tileSize(this.asset!) : atlas?.asset.definition.tilesize || tileSize(this.asset!);
    const t = this.tileTexture(
      key,
      data,
      layer.dimensions.X,
      layer.dimensions.Y,
    );
    this.quad(p, 0, 0, options.width, options.height, options);
    const localCamera = layerCamera(camera, layer);
    gl.uniform2f(this.uniform(p, "u_camera"), localCamera.x, localCamera.y);
    gl.uniform2f(
      this.uniform(p, "u_worldSize"),
      options.width / camera.zoom,
      options.height / camera.zoom,
    );
    gl.uniform2f(this.uniform(p, "u_tileSize"), s.width, s.height);
    gl.uniform2i(
      this.uniform(p, "u_dimensions"),
      layer.dimensions.X,
      layer.dimensions.Y,
    );
    gl.uniform1i(
      this.uniform(p, "u_perRow"),
      atlas?.asset.definition.tiles_per_row || 1,
    );
    gl.uniform1i(this.uniform(p, "u_animWidth"), atlas?.size || 1);
    gl.uniform1f(this.uniform(p, "u_opacity"), layer.alpha ?? 1);
    gl.uniform1i(this.uniform(p, "u_mode"), mode);
    gl.uniform1i(this.uniform(p, "u_zoneIds"), options.showZoneIds ? 1 : 0);
    gl.uniform1i(this.uniform(p, "u_zonePatterns"), options.zonePatterns ? 1 : 0);
    gl.uniform1f(this.uniform(p, "u_zoom"), camera.zoom);
    // Always bind valid float and integer textures, including procedural zone mode.
    const anyAtlas =
      atlas || (this.atlases.values().next().value as AtlasTexture | undefined);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(
      gl.TEXTURE_2D,
      anyAtlas?.image.texture || this.fallbackImage,
    );
    gl.uniform1i(this.uniform(p, "u_image"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.uniform1i(this.uniform(p, "u_tiles"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, anyAtlas?.animation || this.fallbackIndex);
    gl.uniform1i(this.uniform(p, "u_animation"), 2);
    this.draw();
  }
  private drawEntity(
    entry: PlayerEntry,
    layer: MapLayer | undefined,
    camera: MapCamera,
    options: MapRenderOptions,
    clipMode = 0,
  ): void {
    const a = this.asset!,
      e = entry.entity,
      s = a.sprites[e.filename],
      image = s && this.images.get(s.imageUrl);
    if (!s || !image) return;
    const b = entityBounds(a, e),
      r = frameRect(s.definition, entry.player.frame),
      p = this.spriteProgram,
      gl = this.gl;
    const { x, y } = layerToScreen(b, camera, layer);
    if (
      x + b.width * camera.zoom < 0 ||
      y + b.height * camera.zoom < 0 ||
      x > options.width ||
      y > options.height
    )
      return;
    this.hitDraws.push({ kind: "entity", entry, layer, clipMode });
    this.quad(p, x, y, b.width * camera.zoom, b.height * camera.zoom, options);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, image.texture);
    gl.uniform1i(this.uniform(p, "u_image"), 0);
    gl.uniform4f(this.uniform(p, "u_source"), r.x, r.y, r.width, r.height);
    const clip = s.regions?.Tall_Redraw || [0, 0, 0, 0];
    gl.uniform4f(this.uniform(p, "u_clip"), clip[0], clip[1], clip[2], clip[3]);
    gl.uniform1i(this.uniform(p, "u_clipMode"), clipMode);
    gl.uniform1f(this.uniform(p, "u_opacity"), layer?.alpha ?? 1);
    this.draw();
  }
  render(camera: MapCamera, options: MapRenderOptions): void {
    if (
      this.disposed ||
      this.lost ||
      !this.asset ||
      options.width <= 0 ||
      options.height <= 0
    )
      return;
    if (!Number.isFinite(camera.zoom) || camera.zoom <= 0)
      throw new Error("Camera zoom must be positive");
    if (options.screenview?.enabled)
      camera = {
        ...camera,
        parallaxOrigin: { x: options.screenview.x, y: options.screenview.y },
      };
    this.parallaxOrigin = camera.parallaxOrigin;
    const gl = this.gl,
      a = this.asset,
      ratio = options.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
    const width = Math.max(1, Math.round(options.width * ratio)),
      height = Math.max(1, Math.round(options.height * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    this.stats.drawCalls = 0;
    this.hitDraws = [];
    gl.clearColor(0.13, 0.14, 0.16, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.solid(
      { x: 0, y: 0, width: options.width, height: options.height },
      options.checker?.colorA || [0.17, 0.18, 0.2, 1],
      options,
      0,
      options.checker?.colorB || [0.22, 0.23, 0.25, 1],
      options.checker?.size || 16,
    );
    const time = Math.max(0, Math.floor(options.timeMs));
    if (time < this.time) this.resetPlayers();
    // Entity lists can be replaced by undo, source reload, clone, or deletion.
    const loadedEntities = a.map.entities.filter(
      (e) => !!a.sprites[e.filename],
    );
    if (
      loadedEntities.length !== this.players.length ||
      loadedEntities.some((e, i) => this.players[i].entity !== e)
    )
      this.resetPlayers();
    const delta = time - this.time;
    for (const entry of this.players) {
      const d = a.sprites[entry.entity.filename]?.definition;
      if (!d) continue;
      entry.player.select(
        d.animations[entry.entity.animation || ""]
          ? entry.entity.animation
          : undefined,
        d,
      );
      entry.player.advance(delta);
    }
    this.time = time;
    this.updateAnimations(time);
    const hidden = (index: number) =>
      options.hiddenLayers instanceof Set
        ? options.hiddenLayers.has(index)
        : (options.hiddenLayers as readonly number[] | undefined)?.includes(
            index,
          );
    const visibleEntities =
      options.showEntities ?? a.map.MAPED_ENTLAYER_VISIBLE ?? true;
    const tall: PlayerEntry[] = [];
    const sorted = [...this.players].sort((aEntry, bEntry) => {
      const ap = entityPosition(a, aEntry.entity),
        bp = entityPosition(a, bEntry.entity);
      return (
        ap.y +
          a.sprites[aEntry.entity.filename].definition.hitbox.height -
          (bp.y + a.sprites[bEntry.entity.filename].definition.hitbox.height) ||
        aEntry.seed - bEntry.seed
      );
    });
    const drawEntities = (name: string, layer?: MapLayer) => {
      if (!visibleEntities || layer?.maped_HIDE_ENTS) return;
      for (const entry of sorted) {
        if ((entry.entity.location.layer || "Entity Layer (E)") !== name)
          continue;
        const canopy = a.sprites[entry.entity.filename].regions?.Tall_Redraw;
        this.drawEntity(entry, layer, camera, options, canopy ? 1 : 0);
        if (canopy) tall.push(entry);
      }
    };
    const drawTall = () => {
      if (!visibleEntities) return;
      for (const entry of tall) {
        const layer = a.map.layers.find(
          (l) => l.name === entry.entity.location.layer,
        );
        this.drawEntity(entry, layer, camera, options, 2);
      }
    };
    let tallDrawn = false;
    for (const token of a.map.renderstring.split(",").map((t) => t.trim())) {
      if (token === "E") {
        drawEntities("Entity Layer (E)");
        continue;
      }
      if (token === "O") {
        if (options.showObstructions) this.drawObstructions(camera, options);
        continue;
      }
      const index = Number(token) - 1,
        l = a.map.layers[index];
      if (!l || !/^\d+$/.test(token)) continue;
      if (!l.MAPED_HIDDEN && !hidden(index)) {
        this.drawLayer(
          `art:${index}`,
          l,
          a.data.tile_data[index] || [],
          camera,
          options,
        );
        drawEntities(l.name, l);
      }
      if (l.name === a.map.tallentitylayer || index === a.map.tallentitylayer) {
        drawTall();
        tallDrawn = true;
      }
    }
    if (!tallDrawn) drawTall();
    if (
      options.showObstructions &&
      !a.map.renderstring
        .split(",")
        .map((t) => t.trim())
        .includes("O")
    )
      this.drawObstructions(camera, options);
    if (options.showZones) this.drawZones(camera, options);
    if (options.showBounds || options.showHitboxes || options.showCanopies) {
      const rect = (
        r: MapRect,
        layer: MapLayer | undefined,
        color: readonly number[],
      ) =>
        this.solid(
          {
            ...layerToScreen(r, camera, layer),
            width: r.width * camera.zoom,
            height: r.height * camera.zoom,
          },
          color,
          options,
          1,
        );
      for (const entry of this.players) {
        const e = entry.entity,
          s = a.sprites[e.filename],
          layer = a.map.layers.find((l) => l.name === e.location.layer),
          b = entityBounds(a, e),
          pos = entityPosition(a, e);
        if (options.showBounds) rect(b, layer, [0, 0.8, 1, 0.85]);
        if (options.showHitboxes)
          rect(
            {
              x: pos.x,
              y: pos.y,
              width: s.definition.hitbox.width,
              height: s.definition.hitbox.height,
            },
            layer,
            [1, 0.8, 0, 0.9],
          );
        const c = s.regions?.Tall_Redraw;
        if (options.showCanopies && c)
          rect(
            { x: b.x + c[0], y: b.y + c[1], width: c[2], height: c[3] },
            layer,
            [1, 0.3, 1, 0.9],
          );
      }
    }
    if (options.screenview?.enabled) {
      const s = options.screenview,
        x = (s.x - camera.x) * camera.zoom,
        y = (s.y - camera.y) * camera.zoom,
        w = s.width * camera.zoom,
        h = s.height * camera.zoom,
        c = [0, 0, 0, s.opacity ?? 0.55];
      const left = Math.max(0, Math.min(options.width, x)),
        top = Math.max(0, Math.min(options.height, y)),
        right = Math.max(0, Math.min(options.width, x + w)),
        bottom = Math.max(0, Math.min(options.height, y + h));
      this.solid({ x: 0, y: 0, width: options.width, height: top }, c, options);
      this.solid(
        {
          x: 0,
          y: bottom,
          width: options.width,
          height: options.height - bottom,
        },
        c,
        options,
      );
      this.solid(
        { x: 0, y: top, width: left, height: Math.max(0, bottom - top) },
        c,
        options,
      );
      this.solid(
        {
          x: right,
          y: top,
          width: options.width - right,
          height: Math.max(0, bottom - top),
        },
        c,
        options,
      );
      this.solid({ x, y, width: w, height: h }, [1, 1, 1, 0.8], options, 1);
    }
  }
  private opaque(
    url: string,
    x: number,
    y: number,
    obstruction = false,
  ): boolean {
    const image = this.images.get(url);
    if (!image || x < 0 || y < 0 || x >= image.width || y >= image.height)
      return false;
    let pixels = this.pixels.get(url);
    if (!pixels) {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return true;
      ctx.drawImage(image.source, 0, 0);
      try {
        pixels = ctx.getImageData(0, 0, image.width, image.height);
        this.pixels.set(url, pixels);
      } catch {
        return true;
      }
    }
    const offset = (Math.floor(y) * image.width + Math.floor(x)) * 4,
      d = pixels.data;
    return (
      d[offset + 3] > 0 &&
      !(d[offset] === 255 && d[offset + 1] === 0 && d[offset + 2] === 255) &&
      (!obstruction || d[offset] > 0 || d[offset + 1] > 0 || d[offset + 2] > 0)
    );
  }
  /** Pick actual visible pixels in draw order. smart=true also chooses the top art layer. */
  pick(
    point: Point,
    camera: MapCamera,
    layerIndex = 0,
    options: { smart?: boolean } = {},
  ): MapPick {
    if (!this.asset) throw new Error("No map loaded");
    camera = {
      ...camera,
      parallaxOrigin: camera.parallaxOrigin ?? this.parallaxOrigin,
    };
    const a = this.asset,
      result = pickMap(a, point, camera, layerIndex);
    delete result.entityIndex;
    for (let i = this.hitDraws.length - 1; i >= 0; i--) {
      const hit = this.hitDraws[i],
        layer = hit.layer;
      if ((layer?.alpha ?? 1) <= 0) continue;
      const world = screenToLayer(point, camera, layer);
      if (hit.kind === "entity") {
        const e = hit.entry.entity,
          s = a.sprites[e.filename],
          b = entityBounds(a, e),
          x = world.x - b.x,
          y = world.y - b.y;
        if (x < 0 || y < 0 || x >= b.width || y >= b.height) continue;
        const clip = s.regions?.Tall_Redraw,
          inside =
            clip &&
            x >= clip[0] &&
            y >= clip[1] &&
            x < clip[0] + clip[2] &&
            y < clip[1] + clip[3];
        if ((hit.clipMode === 1 && inside) || (hit.clipMode === 2 && !inside))
          continue;
        const frame = frameRect(s.definition, hit.entry.player.frame);
        if (!this.opaque(s.imageUrl, frame.x + x, frame.y + y)) continue;
        result.entityIndex = a.map.entities.indexOf(e);
        return result;
      }
      if (!options.smart && hit.index !== layerIndex) continue;
      const s = tileSize(a, hit.layer),
        tx = Math.floor(world.x / s.width),
        ty = Math.floor(world.y / s.height);
      if (
        tx < 0 ||
        ty < 0 ||
        tx >= hit.layer.dimensions.X ||
        ty >= hit.layer.dimensions.Y
      )
        continue;
      const tile = hit.data[ty * hit.layer.dimensions.X + tx] || 0,
        tileset = a.tilesets[hit.layer.vsp || "default"];
      if (!tile || !tileset) continue;
      const id = animatedTile(tileset.definition, tile, this.time),
        perRow = tileset.definition.tiles_per_row;
      if (
        !this.opaque(
          tileset.imageUrl,
          (id % perRow) * s.width + (world.x % s.width),
          Math.floor(id / perRow) * s.height + (world.y % s.height),
        )
      )
        continue;
      return { ...result, tileX: tx, tileY: ty, tile, layerIndex: hit.index };
    }
    return result;
  }
  /** Collision masks combine by union, independently of overlay visibility. */
  isObstructed(point: Point): boolean {
    if (!this.asset) return false;
    const a = this.asset,
      d = dimensions(a);
    const layers =
      a.map.format_version === 2 && a.map.obstruction_layers
        ? a.map.obstruction_layers
        : [
            {
              name: "Obstructions",
              id: "legacy",
              dimensions: d,
              vsp: "obstructions",
              ...a.map.obstructions_layer,
            },
          ];
    for (const layer of layers) {
      const tileset = a.tilesets[layer.vsp || "obstructions"];
      if (!tileset) continue;
      const s = tileset.definition.tilesize,
        x = point.x - (layer.offset?.X || 0),
        y = point.y - (layer.offset?.Y || 0),
        tx = Math.floor(x / s.width),
        ty = Math.floor(y / s.height);
      if (
        tx < 0 ||
        ty < 0 ||
        tx >= layer.dimensions.X ||
        ty >= layer.dimensions.Y
      )
        continue;
      const data =
          a.map.format_version === 2 && a.map.obstruction_layers
            ? a.data.obstruction_data?.[layer.id]
            : a.data.legacy_obstruction_data,
        tile = data?.[ty * layer.dimensions.X + tx] || 0;
      if (!tile) continue;
      const id = animatedTile(tileset.definition, tile, this.time),
        perRow = tileset.definition.tiles_per_row;
      if (
        this.opaque(
          tileset.imageUrl,
          (id % perRow) * s.width + (x % s.width),
          Math.floor(id / perRow) * s.height + (y % s.height),
          true,
        )
      )
        return true;
    }
    return false;
  }
  private drawObstructions(camera: MapCamera, options: MapRenderOptions): void {
    const a = this.asset!,
      d = dimensions(a);
    if (a.map.format_version === 2 && a.map.obstruction_layers) {
      for (const layer of a.map.obstruction_layers)
        if (!layer.MAPED_HIDDEN)
          this.drawLayer(
            `obs:${layer.id}`,
            { ...layer, alpha: (layer.alpha ?? 1) * 0.55 },
            a.data.obstruction_data?.[layer.id] || [],
            camera,
            options,
            1,
          );
    } else if (a.data.legacy_obstruction_data)
      this.drawLayer(
        "legacy-obstructions",
        {
          name: "Obstructions",
          vsp: "obstructions",
          dimensions: d,
          ...a.map.obstructions_layer,
          alpha: 0.55,
        },
        a.data.legacy_obstruction_data,
        camera,
        options,
        1,
      );
  }
  private zoneValues: number[] = [];
  private drawZones(camera: MapCamera, options: MapRenderOptions): void {
    const opacity = Number.isFinite(options.zoneOpacity)
      ? Math.max(0, Math.min(1, options.zoneOpacity!)) : 0.35;
    if (opacity === 0) return;
    const a = this.asset!,
      d = a.map.zone_layer_size || dimensions(a);
    if (this.dirty.has("zones") || this.zoneValues.length !== d.X * d.Y) {
      this.zoneValues = new Array(d.X * d.Y).fill(0);
      for (const z of a.data.zone_data || [])
        if (z.x >= 0 && z.y >= 0 && z.x < d.X && z.y < d.Y)
          this.zoneValues[z.y * d.X + z.x] = z.z;
    }
    this.drawLayer(
      "zones",
      { name: "Zones", dimensions: d, alpha: opacity },
      this.zoneValues,
      camera,
      options,
      2,
    );
  }
  async restore(): Promise<void> {
    if (this.disposed) return;
    if (this.restoring) return this.restoring;
    this.restoring = (async () => {
      const wasLost = this.lost;
      this.lost = true;
      this.uniforms.clear();
      this.clearResources(wasLost);
      const gl = this.gl;
      if (!wasLost) {
        gl.deleteProgram(this.tileProgram);
        gl.deleteProgram(this.spriteProgram);
        gl.deleteProgram(this.solidProgram);
        gl.deleteVertexArray(this.vao);
        gl.deleteTexture(this.fallbackImage);
        gl.deleteTexture(this.fallbackIndex);
      }
      this.initialize();
      if (this.asset) await this.load(this.asset);
      if (!this.disposed) this.lost = false;
    })();
    try {
      await this.restoring;
    } finally {
      this.restoring = undefined;
    }
  }
  private clearResources(skipDeletes = false): void {
    const gl = this.gl;
    if (!skipDeletes) {
      for (const i of this.images.values()) gl.deleteTexture(i.texture);
      for (const a of this.atlases.values()) gl.deleteTexture(a.animation);
      for (const t of this.tiles.values()) gl.deleteTexture(t.texture);
    }
    this.images.clear();
    this.atlases.clear();
    this.tiles.clear();
    this.dirty.clear();
    this.zoneValues = [];
    this.pixels.clear();
    this.hitDraws = [];
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.controller?.abort();
    this.clearResources();
    const gl = this.gl;
    gl.deleteProgram(this.tileProgram);
    gl.deleteProgram(this.spriteProgram);
    gl.deleteProgram(this.solidProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.fallbackImage);
    gl.deleteTexture(this.fallbackIndex);
    this.uniforms.clear();
    this.players = [];
    this.asset = undefined;
    this.canvas.removeEventListener("webglcontextlost", this.lostHandler);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.restoreHandler,
    );
  }
}
