import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyMap, sampleObstruction, obstructionPixel, validateCollisionMasks} from '../dist/mod.js';

test('pixel collision uses alpha, black and magenta conventions', () => {
  const mask = {width: 4, height: 1, data: [255,255,255,255, 0,0,0,255, 255,0,255,255, 255,255,255,0]};
  assert.deepEqual([0,1,2,3,4,-1].map(x=>obstructionPixel(mask,x,0)), [true,false,false,false,false,false]);
});
test('CPU collision unions offset rectangular layers, ignores editor visibility, uses explicit time', () => {
  const a = createEmptyMap();
  a.map.tile_size={width:4,height:8}; a.map.dimensions={X:2,Y:2};
  a.map.obstruction_layers=[{id:'a',name:'A',dimensions:{X:1,Y:1},vsp:'o',offset:{X:-2,Y:4},MAPED_HIDDEN:true},
    {id:'b',name:'B',dimensions:{X:1,Y:1},vsp:'o',offset:{X:10,Y:10}}];
  a.data.obstruction_data={a:[1],b:[1]};
  a.tilesets.o={imageUrl:'mask',definitionUrl:'o',definition:{tilesize:{width:2,height:3},tiles_per_row:3,source_image:'mask',animations:[{start:1,end:2,delay:1,mode:0}]}};
  const calls=[]; const pixel=(...args)=>{calls.push(args);return true;};
  assert.equal(sampleObstruction(a,{x:-1,y:6},0,pixel),true);
  assert.deepEqual(calls.pop(),['mask',3,2]);
  assert.equal(sampleObstruction(a,{x:11,y:12},10,pixel),true);
  assert.deepEqual(calls.pop(),['mask',5,2]);
  assert.equal(sampleObstruction(a,{x:0,y:0},0,pixel),false);
  assert.throws(()=>validateCollisionMasks(a,new Map()),/collision image/);
  const mask={width:6,height:3,data:new Uint8Array(72)};
  validateCollisionMasks(a,new Map([['mask',mask]]));
  mask.width=4; mask.data=new Uint8Array(48);
  assert.throws(()=>validateCollisionMasks(a,new Map([['mask',mask]])),/outside atlas/);
});
test('legacy collision supports missing empty layer but rejects malformed authored data',()=>{
  const a=createEmptyMap(); delete a.map.format_version; delete a.map.obstruction_layers;
  a.map.layers=[{name:'ground',dimensions:{X:1,Y:1}}];
  validateCollisionMasks(a,new Map());
  a.data.legacy_obstruction_data=[-1];
  assert.throws(()=>validateCollisionMasks(a,new Map()),/Invalid obstruction/);
});
