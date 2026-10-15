// Run with: ../breaditor-v2/node_modules/.bin/electron test/webgl.smoke.cjs
// Uses a real hidden Chromium window, synthetic fixtures, then the bundled Farmsville.
const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const esbuild = require("../../breaditor-v2/node_modules/esbuild");
const root = path.resolve(__dirname, "..");
app.commandLine.appendSwitch("use-angle", "swiftshader");
app.on("window-all-closed", () => {});
const timeout = setTimeout(() => {
  console.error("WebGL smoke timed out");
  app.exit(1);
}, 45000);
let server, win, fixtureImage;
app
  .whenReady()
  .then(async () => {
    const entry = `import * as core from ${JSON.stringify(
      path.join(root, "dist/mod.js"),
    )}; import * as webgl from ${JSON.stringify(
      path.join(root, "dist/webgl.js"),
    )}; window.maplib={...core,...webgl};`;
    const bundle = esbuild.buildSync({
      stdin: {
        contents: entry,
        resolveDir: root,
        sourcefile: "smoke-entry.js",
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "chrome110",
    }).outputFiles[0].contents;
    const contentRoot =
      process.env.FARMSVILLE_CONTENT_ROOT ||
      path.resolve(root, "../breaditor-v2/assets/sully");
    server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (pathname === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><canvas id="map"></canvas><script src="/bundle.js"></script>',
        );
        return;
      }
      if (pathname === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(bundle);
        return;
      }
      if (pathname === "/fixture.png") {
        if (req.method === "PUT") {
          const parts = [];
          req.on("data", (part) => parts.push(part));
          req.on("end", () => {
            fixtureImage = Buffer.concat(parts);
            res.end("ok");
          });
          return;
        }
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.end(fixtureImage);
        return;
      }
      if (pathname.startsWith("/content/")) {
        const target = path.resolve(
          contentRoot,
          pathname.slice("/content/".length),
        );
        if (!target.startsWith(path.resolve(contentRoot) + path.sep)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        try {
          res.setHeader(
            "Content-Type",
            target.endsWith(".png") ? "image/png" : "application/json",
          );
          res.end(fs.readFileSync(target));
        } catch {
          res.statusCode = 404;
          res.end();
        }
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.on("console-message", (_, level, message) => {
      if (level >= 2) console.error(message);
    });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    const result = await win.webContents.executeJavaScript(
      `(${async function () {
        const { createEmptyMap, loadMap, WebGLMapRenderer, adaptLegacySprite } =
          window.maplib;
        const canvas = document.getElementById("map"),
          renderer = new WebGLMapRenderer(canvas),
          gl = canvas.getContext("webgl2");
        const image = document.createElement("canvas");
        image.width = 32;
        image.height = 16;
        const ctx = image.getContext("2d");
        ctx.fillStyle = "#ff00ff";
        ctx.fillRect(0, 0, 32, 16);
        ctx.fillStyle = "#00ff00";
        ctx.fillRect(16, 0, 16, 16);
        ctx.fillStyle = "#000";
        ctx.fillRect(16, 0, 8, 8);
        const imageUrl = image.toDataURL(),
          a = createEmptyMap();
        a.map.dimensions = { X: 2, Y: 2 };
        a.map.tile_size = { width: 16, height: 16 };
        a.tilesets.art = {
          definition: {
            tilesize: { width: 16, height: 16 },
            tiles_per_row: 2,
            source_image: "fixture.png",
          },
          imageUrl,
          definitionUrl: "https://fixture.invalid/art.json",
        };
        a.tilesets.obstructions = { ...a.tilesets.art };
        a.map.vsp = { art: "art.json", obstructions: "obs.json" };
        a.map.layers = [
          { name: "Ground", vsp: "art", dimensions: { X: 2, Y: 2 } },
        ];
        a.map.renderstring = "1,E";
        a.data.tile_data = [[1, 1, 1, 1]];
        a.map.obstruction_layers = [
          {
            id: "legacy",
            name: "Walls",
            vsp: "obstructions",
            dimensions: { X: 2, Y: 2 },
            MAPED_HIDDEN: true,
          },
        ];
        a.data.legacy_obstruction_data = [0, 0, 0, 0];
        a.data.obstruction_data = { legacy: [1, 0, 0, 0] };
        const raw = {
          dims: [16, 16],
          hitbox: [0, 0, 16, 16],
          frames: 1,
          per_row: 1,
          inner_pad: 0,
          outer_pad: 0,
          image: "sprite.png",
          animations: { Still: [0, "Static"] },
        };
        const spriteCanvas = document.createElement("canvas");
        spriteCanvas.width = 16;
        spriteCanvas.height = 16;
        const sc = spriteCanvas.getContext("2d");
        sc.fillStyle = "blue";
        sc.fillRect(8, 0, 8, 16);
        a.sprites["npc.json"] = {
          definition: adaptLegacySprite(raw),
          raw,
          imageUrl: spriteCanvas.toDataURL(),
          definitionUrl: "https://fixture.invalid/npc.json",
        };
        a.map.entities = [
          {
            filename: "npc.json",
            animation: "Still",
            location: { layer: "Entity Layer (E)", px: 0, py: 0 },
          },
        ];
        await renderer.load(a);
        const camera = { x: 0, y: 0, zoom: 4 },
          opts = { width: 128, height: 128, timeMs: 0, pixelRatio: 1 };
        renderer.render(camera, opts);
        const error = gl.getError();
        if (error !== 0) throw new Error("GL error " + error);
        function sample(x, y) {
          const out = new Uint8Array(4);
          gl.readPixels(
            x,
            canvas.height - 1 - y,
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            out,
          );
          return [...out];
        }
        const green = sample(50, 50),
          blue = sample(40, 20),
          black = sample(10, 10);
        const transparentPick = renderer.pick({ x: 4, y: 4 }, camera, 0, {
            smart: true,
          }),
          opaquePick = renderer.pick({ x: 40, y: 20 }, camera, 0, {
            smart: true,
          });
        const blackOpen = renderer.isObstructed({ x: 1, y: 1 }),
          greenBlocked = renderer.isObstructed({ x: 10, y: 10 });
        const uploads = renderer.stats.tileUploads;
        renderer.render(camera, { ...opts, timeMs: 10 });
        const unchangedUploads = renderer.stats.tileUploads,
          pixelsBefore = renderer.stats.tilePixelsUploaded;
        a.data.tile_data[0][3] = 0;
        renderer.invalidate(0);
        renderer.render(camera, opts);
        const invalidatedUploads = renderer.stats.tileUploads,
          changedPixels = renderer.stats.tilePixelsUploaded - pixelsBefore;
        renderer.invalidate();
        renderer.render(camera, opts);
        const redundantInvalidationUploads = renderer.stats.tileUploads;
        const uploadImage = async () =>
          fetch("/fixture.png", {
            method: "PUT",
            body: await (await fetch(image.toDataURL())).blob(),
          });
        await uploadImage();
        a.tilesets.art.imageUrl = new URL("/fixture.png", location.href).href;
        await renderer.load(a);
        renderer.render(camera, opts);
        const beforeImageReload = sample(80, 40);
        ctx.fillStyle = "#ffff00";
        ctx.fillRect(16, 0, 16, 16);
        await uploadImage();
        await renderer.load(a);
        renderer.render(camera, opts);
        const afterImageReload = sample(80, 40);
        // No art tileset must still permit zone rendering on an extended map.
        const empty = createEmptyMap();
        empty.map.dimensions = { X: 2, Y: 2 };
        empty.data.zone_data = [{ x: 0, y: 0, z: 1 }];
        await renderer.load(empty);
        renderer.render(camera, { ...opts, showZones: true });
        const zonePixel = sample(20, 20),
          zoneError = gl.getError();
        // Exercise retained animation textures, canopies, all 50 sprite definitions and large atlases.
        const farmsville = await loadMap(
            new URL("/content/maps/json/farmsville.map.json", location.href)
              .href,
          ),
          errors = farmsville.diagnostics.filter((d) => d.severity === "error");
        if (errors.length) throw new Error(JSON.stringify(errors));
        await renderer.load(farmsville);
        renderer.render(
          { x: 0, y: 0, zoom: 0.125 },
          { width: 800, height: 650, timeMs: 0, pixelRatio: 1 },
        );
        const farmError = gl.getError();
        const farmUploads = renderer.stats.tileUploads;
        renderer.render(
          { x: 0, y: 0, zoom: 0.125 },
          { width: 800, height: 650, timeMs: 1000, pixelRatio: 1 },
        );
        const farmUnchanged = renderer.stats.tileUploads;
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        const colors = new Set();
        for (let i = 0; i < pixels.length; i += 16)
          colors.add(pixels[i] + "," + pixels[i + 1] + "," + pixels[i + 2]);
        const stats = { ...renderer.stats };
        const ext = gl.getExtension("WEBGL_lose_context");
        let restored = false;
        if (ext) {
          const lost = new Promise((resolve) =>
            canvas.addEventListener("webglcontextlost", resolve, {
              once: true,
            }),
          );
          ext.loseContext();
          await lost;
          await new Promise((resolve) => setTimeout(resolve, 100));
          const restoreEvent = new Promise((resolve) =>
            canvas.addEventListener("webglcontextrestored", resolve, {
              once: true,
            }),
          );
          ext.restoreContext();
          await restoreEvent;
          await renderer.restore();
          renderer.render(
            { x: 0, y: 0, zoom: 0.125 },
            { width: 800, height: 650, timeMs: 1000, pixelRatio: 1 },
          );
          restored = gl.getError() === 0;
        }
        renderer.dispose();
        renderer.dispose();
        return {
          green,
          blue,
          black,
          transparentPick,
          opaquePick,
          blackOpen,
          greenBlocked,
          uploads,
          unchangedUploads,
          invalidatedUploads,
          redundantInvalidationUploads,
          beforeImageReload,
          afterImageReload,
          changedPixels,
          zonePixel,
          zoneError,
          farmError,
          farmUploads,
          farmUnchanged,
          colors: colors.size,
          restored,
          stats,
        };
      }.toString()})()`,
    );
    assert.deepEqual(result.green, [0, 0, 255, 255]); // NPC covers the green tile.
    assert.deepEqual(result.blue, [0, 0, 255, 255]);
    assert.deepEqual(result.black, [0, 0, 0, 255]);
    assert.equal(result.transparentPick.entityIndex, undefined);
    assert.equal(result.opaquePick.entityIndex, 0);
    assert.equal(result.blackOpen, false);
    assert.equal(result.greenBlocked, true);
    assert.equal(result.uploads, result.unchangedUploads);
    assert.equal(result.invalidatedUploads, result.uploads + 1);
    assert.equal(result.changedPixels, 1);
    assert.deepEqual(result.beforeImageReload, [0, 255, 0, 255]);
    assert.deepEqual(result.afterImageReload, [255, 255, 0, 255]);
    assert.equal(
      result.redundantInvalidationUploads,
      result.invalidatedUploads,
    );
    assert.equal(result.restored, true);
    assert.equal(result.zoneError, 0);
    assert.equal(result.farmError, 0);
    assert.equal(result.farmUploads, result.farmUnchanged);
    assert.ok(result.colors > 100);
    console.log("WebGL smoke: " + JSON.stringify(result));
  })
  .then(
    () => {
      clearTimeout(timeout);
      win?.destroy();
      server?.close();
      app.exit(0);
    },
    (error) => {
      console.error(error);
      clearTimeout(timeout);
      win?.destroy();
      server?.close();
      app.exit(1);
    },
  );
