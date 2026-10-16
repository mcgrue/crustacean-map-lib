import { validateCrusty } from "crustacean-sprite-lib";
function record(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label}: expected object`);
}
function positive(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`${label}: expected positive integer`);
}
function grid(value, label) {
    record(value, label);
    positive(value.X, `${label}.X`);
    positive(value.Y, `${label}.Y`);
    if (!Number.isSafeInteger(value.X * value.Y))
        throw new Error(`${label}: oversized grid`);
}
/** Resolve portable URL paths, Windows drive paths, UNC paths, and legacy backslashes. */
export function resolveAssetUrl(reference, base) {
    let normalized = reference.replace(/\\/g, "/");
    if (/^[a-zA-Z]:\//.test(normalized))
        normalized = `file:///${normalized}`;
    else if (reference.startsWith("\\\\"))
        normalized = `file:${normalized}`;
    return new URL(normalized, base).href;
}
export function validateMap(map, data) {
    record(map, "map");
    record(data, "data");
    record(map.vsp, "vsp");
    if (map.format_version !== undefined &&
        map.format_version !== 1 &&
        map.format_version !== 2)
        throw new Error(`Unsupported map format_version ${map.format_version}`);
    if (!Array.isArray(map.layers) ||
        !Array.isArray(map.entities) ||
        !Array.isArray(data.tile_data))
        throw new Error("Map requires layers, entities and tile_data arrays");
    if (typeof map.renderstring !== "string")
        throw new Error("Map requires renderstring");
    if (map.tile_size) {
        positive(map.tile_size.width, "tile_size.width");
        positive(map.tile_size.height, "tile_size.height");
    }
    if (map.dimensions)
        grid(map.dimensions, "dimensions");
    for (const [i, l] of map.layers.entries()) {
        record(l, `layers[${i}]`);
        grid(l.dimensions, `layers[${i}].dimensions`);
        if (typeof l.name !== "string")
            throw new Error(`layers[${i}].name: expected string`);
    }
    for (const [i, e] of map.entities.entries()) {
        record(e, `entities[${i}]`);
        record(e.location, `entities[${i}].location`);
        if (typeof e.filename !== "string")
            throw new Error(`entities[${i}].filename: expected string`);
    }
    for (const [i, a] of data.tile_data.entries())
        if (!Array.isArray(a) || a.some((v) => !Number.isInteger(v) || v < 0))
            throw new Error(`tile_data[${i}]: expected nonnegative tile indices`);
    if (map.obstruction_layers) {
        if (map.format_version !== 2)
            throw new Error("obstruction_layers requires format_version 2");
        const ids = new Set();
        for (const l of map.obstruction_layers) {
            grid(l.dimensions, `obstruction layer ${l.id}`);
            if (!l.id || ids.has(l.id))
                throw new Error("Obstruction layer IDs must be unique");
            ids.add(l.id);
        }
    }
}
/** Normalize legacy timing and zero hitboxes in memory; never rewrites its source. */
export function adaptLegacySprite(raw) {
    if (raw.version !== undefined)
        return validateCrusty(raw);
    const clone = JSON.parse(JSON.stringify(raw));
    clone.version = 1;
    const zeroHitbox = Array.isArray(clone.hitbox) && (!clone.hitbox[2] || !clone.hitbox[3]);
    const hitbox = clone.hitbox;
    if (zeroHitbox)
        clone.hitbox = [
            hitbox[0],
            hitbox[1],
            Math.max(1, hitbox[2]),
            Math.max(1, hitbox[3]),
        ];
    const parsed = validateCrusty(clone);
    const animations = {};
    for (const [name, a] of Object.entries(parsed.animations))
        animations[name] = Object.freeze({
            ...a,
            instructions: Object.freeze(a.instructions.map((i) => Object.freeze({
                ...i,
                delayMs: a.mode === "Static" || a.mode === "StaticRandom"
                    ? i.delayMs
                    : Math.min(2147483647, i.delayMs * 10),
            }))),
        });
    return Object.freeze({
        ...parsed,
        animations: Object.freeze(animations),
        hitbox: zeroHitbox
            ? Object.freeze({
                x: hitbox[0],
                y: hitbox[1],
                width: hitbox[2],
                height: hitbox[3],
            })
            : parsed.hitbox,
    });
}
export async function loadMap(url, options = {}) {
    const fetcher = options.fetch || globalThis.fetch;
    if (!fetcher)
        throw new Error("loadMap requires a fetch implementation");
    const mapUrl = resolveAssetUrl(url);
    const mapDir = new URL(".", mapUrl).href;
    const dataUrl = mapUrl.replace(/\.map\.json(?=\?|#|$)/, ".map.data.json");
    if (dataUrl === mapUrl)
        throw new Error("Map URL must end in .map.json");
    const dependencies = new Set();
    async function json(target, optional = false) {
        // Keep missing required paths watchable so a newly created/fixed dependency recovers.
        if (!optional)
            dependencies.add(target);
        if (options.signal?.aborted) {
            const e = new Error("Map load cancelled");
            e.name = "AbortError";
            throw e;
        }
        let response;
        try {
            response = await fetcher(target, { signal: options.signal });
        }
        catch (e) {
            if (optional && !options.signal?.aborted)
                return undefined;
            throw e;
        }
        if (!response.ok) {
            if (optional && response.status === 404)
                return undefined;
            throw new Error(`${target}: HTTP ${response.status}`);
        }
        dependencies.add(target);
        return response.json();
    }
    const [map, data] = await Promise.all([json(mapUrl), json(dataUrl)]);
    validateMap(map, data);
    const config = options.contentRootUrl || map.MAPED_CONTENT_ROOT
        ? undefined
        : await json(new URL("$$$_MAPED.json", mapDir).href, true);
    const root = new URL(resolveAssetUrl(options.contentRootUrl ||
        map.MAPED_CONTENT_ROOT ||
        config?.path_to_chrs ||
        "./", mapDir));
    if (!root.pathname.endsWith("/"))
        root.pathname += "/";
    const contentRootUrl = root.href;
    const asset = {
        map,
        data,
        tilesets: {},
        sprites: {},
        mapUrl,
        dataUrl,
        contentRootUrl,
        dependencies: [],
        diagnostics: [],
    };
    const warning = (url, e) => asset.diagnostics.push({
        severity: "error",
        url,
        message: e instanceof Error ? e.message : String(e),
    });
    await Promise.all(Object.entries(map.vsp).map(async ([key, path]) => {
        const definitionUrl = resolveAssetUrl(path, mapDir);
        try {
            const definition = await json(definitionUrl);
            record(definition, "tileset");
            positive(definition.tilesize?.width, "tilesize.width");
            positive(definition.tilesize?.height, "tilesize.height");
            positive(definition.tiles_per_row, "tiles_per_row");
            if (typeof definition.source_image !== "string")
                throw new Error("Tileset requires source_image");
            if (definition.animations) {
                if (!Array.isArray(definition.animations))
                    throw new Error("Tileset animations must be an array");
                for (const a of definition.animations)
                    if (!Number.isInteger(a.start) ||
                        a.start < 0 ||
                        !Number.isInteger(a.end) ||
                        a.end < a.start ||
                        !Number.isInteger(a.delay) ||
                        a.delay < 0 ||
                        !Number.isInteger(a.mode) ||
                        a.mode < 0 ||
                        a.mode > 4)
                        throw new Error("Invalid tileset animation range, delay, or mode");
            }
            const imageUrl = definition.source_image.startsWith("~/")
                ? resolveAssetUrl(definition.source_image.slice(2), contentRootUrl)
                : resolveAssetUrl(definition.source_image, definitionUrl);
            dependencies.add(imageUrl);
            asset.tilesets[key] = { definition, definitionUrl, imageUrl };
        }
        catch (e) {
            if (options.signal?.aborted)
                throw e;
            warning(definitionUrl, e);
        }
    }));
    await Promise.all([...new Set(map.entities.map((e) => e.filename))]
        .filter(Boolean)
        .map(async (filename) => {
        const definitionUrl = resolveAssetUrl(filename, contentRootUrl);
        try {
            const raw = await json(definitionUrl), definition = adaptLegacySprite(raw);
            const imageUrl = raw.image.startsWith("~/")
                ? resolveAssetUrl(raw.image.slice(2), contentRootUrl)
                : resolveAssetUrl(raw.image, definitionUrl);
            dependencies.add(imageUrl);
            asset.sprites[filename] = {
                raw,
                definition,
                definitionUrl,
                imageUrl,
                regions: raw.regions,
            };
        }
        catch (e) {
            if (options.signal?.aborted)
                throw e;
            warning(definitionUrl, e);
        }
    }));
    for (let i = 0; i < map.layers.length; i++)
        if ((data.tile_data[i]?.length || 0) !==
            map.layers[i].dimensions.X * map.layers[i].dimensions.Y)
            asset.diagnostics.push({
                severity: "warning",
                message: `Layer ${i + 1} tile count differs from its dimensions; data is preserved`,
            });
    if (data.tile_data.length > map.layers.length)
        asset.diagnostics.push({
            severity: "warning",
            message: `Preserving ${data.tile_data.length - map.layers.length} surplus tile array(s)`,
        });
    if (options.signal?.aborted) {
        const e = new Error("Map load cancelled");
        e.name = "AbortError";
        throw e;
    }
    asset.dependencies = [...dependencies].sort();
    return asset;
}
