import {test} from 'node:test';
import assert from 'node:assert/strict';
import {facePose} from '../lib/face-art';
test('face pose scales normalized eyes and anchors the nose for non-square video',()=>{
 const p=facePose([{x:.4,y:.4},{x:.6,y:.4},{x:.5,y:.6}],640,360)!;
 assert.equal(p.x,320);assert.equal(p.y,144);assert(Math.abs(p.scale-128)<1e-9);assert.equal(p.angle,0);assert.equal(p.noseX,0);assert(Math.abs(p.noseY-.5625)<1e-9);
});
test('face pose uses a stable eye order and follows head roll',()=>{
 const points=[{x:.4,y:.4},{x:.6,y:.6},{x:.4,y:.6}];
 const a=facePose(points,400,400)!,b=facePose([points[1],points[0],points[2]],400,400)!;
 assert.deepEqual(a,b);assert(Math.abs(a.angle-Math.PI/4)<1e-9);assert(Math.abs(a.noseX)<1e-9);assert(Math.abs(a.noseY-.5)<1e-9);
});
test('missing, invalid, or too-small faces do not draw an overlay',()=>{
 assert.equal(facePose([],640,360),null);assert.equal(facePose([{x:NaN,y:0},{x:.4,y:.4},{x:.5,y:.5}],640,360),null);assert.equal(facePose([{x:.4,y:.4},{x:.401,y:.4},{x:.4,y:.5}],640,360),null);
});
