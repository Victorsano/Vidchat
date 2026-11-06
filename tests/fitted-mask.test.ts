import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fittedMask} from '../lib/fitted-mask';
function face(){const points=Array.from({length:478},()=>({x:.5,y:.5}));for(const [i,x,y] of [[6,.5,.38],[1,.5,.49],[234,.25,.45],[93,.27,.6],[454,.75,.45],[323,.73,.6],[172,.32,.72],[397,.68,.72],[152,.5,.8]])points[i]={x,y};return points}
test('mask anchors to bridge, cheek contours and chin, independent of eye spacing',()=>{
 const fit=fittedMask(face(),640,360)!;
 assert.deepEqual(fit.bridge,{x:320,y:136.8});assert.deepEqual(fit.chin,{x:320,y:288});
 assert(fit.left.cheek.x<fit.bridge.x&&fit.right.cheek.x>fit.bridge.x);
 const changed=face();changed[152].y=.9;changed[234].x=.2;
 const next=fittedMask(changed,640,360)!;
 assert.equal(next.chin.y,324);assert(next.left.cheek.x<fit.left.cheek.x);assert.equal(next.bridge.x,fit.bridge.x);
});
test('face turn narrows the corresponding mask side instead of using a fixed width',()=>{
 const points=face();const before=fittedMask(points,640,360)!;
 points[6].x=.6;points[1].x=.62;points[454].x=.7;points[323].x=.69;
 const after=fittedMask(points,640,360)!;
 assert(after.right.cheek.x-after.bridge.x<before.right.cheek.x-before.bridge.x);
 assert(after.bridge.x-after.left.cheek.x>before.bridge.x-before.left.cheek.x);
});
test('fit rejects missing or invalid landmarks and scales with video dimensions',()=>{
 assert.equal(fittedMask([],640,360),null);
 const points=face();const small=fittedMask(points,320,180)!,large=fittedMask(points,640,360)!;
 assert.equal(large.span,small.span*2);assert.equal(large.chin.y,small.chin.y*2);
 points[152].x=NaN;assert.equal(fittedMask(points,640,360),null);
});
