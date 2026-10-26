# Crustacean Map library

Portable TypeScript loading, geometry, serialization and a WebGL 2 renderer for
CrustaceanMap (CrustyMap). Emits ESM JavaScript and declarations compatible with
TypeScript 4.6. Core imports run without DOM globals in Node or Deno; the renderer
is a separate browser-only entry point. Requires `crustacean-sprite-lib` as a peer.

```ts
import { loadMap, bounds, serializeMap } from "crustacean-map-lib";
import { WebGLMapRenderer } from "crustacean-map-lib/webgl";

const asset = await loadMap(mapUrl, { signal, contentRootUrl });
const renderer = new WebGLMapRenderer(canvas);
await renderer.load(asset, { signal });
renderer.render(
  { x: 0, y: 0, zoom: 1 },
  {
    width: 800,
    height: 600,
    timeMs: 0,
    showEntities: true,
  },
);
const hit = renderer.pick({ x: 100, y: 100 }, camera, selectedLayer, {
  smart: true,
});
const writes = serializeMap(asset); // { map: JSON text, data: JSON text }
renderer.dispose();
```

Zone overlays support `zoneOpacity` (0..1, default 0.35), `showZoneIds`, and
`zonePatterns` alongside `showZones`. IDs and patterns are opt-in, use no external
font or atlas, and retain the original zone indexes. Zero is empty; opacity zero
skips the overlay. Numeric labels are hidden when cells are too small to read.
These rendering options do not modify or serialize into map data.

`MapAsset` retains mutable source `map` and `data`, loaded tilesets/sprites, all
dependency URLs and diagnostics. Content-root precedence is an explicit option,
`MAPED_CONTENT_ROOT` relative to the map, then adjacent `$$$_MAPED.json`'s
`path_to_chrs`. The companion file replaces `.map.json` with `.map.data.json`.
Tilesets resolve relative to the map, entities relative to the content root, and
images relative to their definition (`~/` explicitly addresses the content root).
Windows drive, UNC and backslash paths are supported. A custom `fetch` enables
filesystem or other host-specific loading without importing filesystem code.

Unknown fields, sparse zones, legacy metadata and surplus tile arrays survive
serialization. Legacy sprite definitions remain unchanged: a separate normalized
definition converts centiseconds to milliseconds and permits zero hitboxes.
Missing dependent definitions produce URL-specific diagnostics. Scripts are data;
the library does not execute game scripts.

Extended maps opt into `format_version: 2`, `tile_size: {width,height}`,
`dimensions: {X,Y}`, and `obstruction_layers` descriptors with stable IDs. Bulk
obstruction arrays reside in companion `obstruction_data`, keyed by descriptor ID.
The library never silently downgrades extended data to the legacy format.

Camera `x,y` is the world position at the viewport's upper-left corner. Zoom is
CSS pixels per world pixel. Rendering supports layer order, offsets, parallax,
alpha, visibility, entity hitbox origins, canopy clipping, tileset/sprite
animation, obstruction/zone overlays, bounds and a shaded screenview rectangle.
Animation uses caller-supplied elapsed milliseconds and deterministic random
sequences. `pick()` uses the last frame's actual draw order and decoded alpha;
`isObstructed(worldPoint)` unions mask pixels independently of visibility.

An enabled `screenview` also anchors parallax to its world-space `x,y` origin.
Moving the editor camera then inspects a fixed preview; moving the origin shifts
layers according to their parallax while parallax-1 layers stay on the base plane.
`pick()` uses the last render's origin, or an explicit `camera.parallaxOrigin`.
For editor overlays and CPU tools, pass the same optional `parallaxOrigin` to
`layerToScreen`, `screenToLayer`, and `pickMap`. `layerCamera` exposes the local
camera used by the renderer. Omitting the origin preserves ordinary parallax;
layer offsets retain their existing unscaled world-pixel meaning.

Call `invalidate(layerIndex?)` after editing. The renderer retains integer tile
textures, compares invalidated data, and uploads only the changed bounding region;
unchanged frames and unchanged invalidations upload no tile data. Public `stats`
allows verification. Resize uses CSS viewport size plus optional `pixelRatio`.
Context loss is handled automatically; `restore()` is also explicit and async.
`dispose()` cancels pending loading and releases GPU resources/listeners.

Build and portable tests: `npm ci`, `npm test`. Set
`FARMSVILLE_CONTENT_ROOT` to a Sully content directory to include the full real-map
dependency and lossless-roundtrip test. The optional `test/webgl.smoke.cjs` runs
under Breaditor's Electron installation and exercises real WebGL pixels, picking,
mask union, incremental uploads and context restoration in a hidden window.

Git consumers receive the committed `dist/` ESM JavaScript and declarations;
installation does not run a compiler. Development pins Sprite to an immutable
public Git commit; there are no sibling filesystem dependencies or install-time
build hooks. Install a release using its complete Git commit hash:

```sh
npm install "git+https://github.com/mcgrue/crustacean-map-lib.git#<release-commit>" "git+https://github.com/mcgrue/crustacean-sprite-lib.git#1b14fe8fa436f70a7cc8673ac6d39f92c3d746fc"
```

After source changes, run `npm run build:dist` and commit all corresponding
`dist/` changes. `npm run check:dist` builds into a retained temporary directory
and checks every output byte, including missing/extra files. LF output is fixed
in TypeScript configuration for identical results on Windows and Linux.

`npm run test:package` packs the actual npm artifact and installs it in an isolated
consumer with the pinned Sprite dependency and TypeScript 4.6.4. It checks ESM
imports without browser globals and root, `/load`, and `/webgl` declarations.
`npm run validate:clean` copies the repository into a retained temporary checkout,
runs a locked installation and these checks without sibling repositories or
optional Farmsville checkout data. Temporary consumer/build artifacts are retained
for inspection; their paths are printed. CI runs the same checks on Node 22,
Ubuntu and Windows, and rejects distribution drift before rebuilding.
