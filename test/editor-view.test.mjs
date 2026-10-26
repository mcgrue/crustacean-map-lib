import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyMap, loadMap, serializeMap} from '../dist/mod.js';

const url = 'https://fixture.test/maps/view.map.json', configUrl = new URL('$$$_MAPED.json', url).href;
const colors = {checkerColorA: [0, .25, .5, 1], checkerColorB: [1, .75, .5, .25]};
function fixture(config, mapRoot, response) {
  const {map, data} = createEmptyMap(); map.vsp = {}; map.layers = []; data.tile_data = [];
  map.custom = 'retain'; if (mapRoot) map.MAPED_CONTENT_ROOT = mapRoot;
  const fetch = async target => target === url ? new Response(JSON.stringify(map))
    : target.endsWith('.map.data.json') ? new Response(JSON.stringify(data))
    : response ? response() : config === undefined ? new Response('', {status: 404}) : new Response(JSON.stringify(config));
  return {map, data, fetch};
}
for (const mode of ['config', 'map', 'explicit']) test(`checker colors load with ${mode} asset root without changing precedence or serialization`, async () => {
  const config = {...colors, path_to_chrs: '../config/', unknown: 'keep'};
  const f = fixture(config, mode === 'map' ? '../map/' : undefined);
  const asset = await loadMap(url, {fetch: f.fetch, ...(mode === 'explicit' ? {contentRootUrl: '../explicit/'} : {})});
  assert.equal(asset.contentRootUrl, `https://fixture.test/${mode}/`);
  assert.deepEqual(asset.editorView, colors); assert(asset.dependencies.includes(configUrl));
  assert.deepEqual(JSON.parse(serializeMap(asset).map), f.map);
  assert.deepEqual(JSON.parse(serializeMap(asset).data), f.data);
  asset.editorView.checkerColorA[0] = .9; assert.equal(config.checkerColorA[0], 0);
});
test('invalid display colors fall back independently, including malformed array shapes', async () => {
  for (const value of [null, 'red', [], [0,0,0], [0,0,0,1,1], [-1,0,0,1], [0,2,0,1], ['0',0,0,1], [null,0,0,1]]) {
    const f = fixture({checkerColorA: value, checkerColorB: colors.checkerColorB});
    assert.deepEqual((await loadMap(url, {fetch: f.fetch})).editorView, {checkerColorB: colors.checkerColorB});
  }
  const f = fixture(undefined); assert.equal((await loadMap(url, {fetch: f.fetch})).editorView, undefined);
});
test('malformed display-only config warns without breaking explicit-root loading; required-root errors still fail', async () => {
  const f = fixture(null, undefined, () => new Response('{broken'));
  const asset = await loadMap(url, {fetch: f.fetch, contentRootUrl: '../explicit/'});
  assert.equal(asset.editorView, undefined); assert.equal(asset.diagnostics[0].severity, 'warning');
  await assert.rejects(loadMap(url, {fetch: f.fetch}), SyntaxError);
});
test('abort during optional config fetch still cancels the whole load', async () => {
  const abort = new AbortController();
  const f = fixture(null, undefined, () => {abort.abort(); throw new DOMException('Aborted', 'AbortError');});
  await assert.rejects(loadMap(url, {fetch: f.fetch, signal: abort.signal, contentRootUrl: '../explicit/'}), {name: 'AbortError'});
});
