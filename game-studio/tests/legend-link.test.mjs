import test from 'node:test';
import assert from 'node:assert/strict';
import {importLegendLayout,exportLegendLayout,LEGEND_SCALE} from '../src/legendLink.js';

const fixture=()=>({schema:'skygate/studio-v0.3',virtualCreditsOnly:true,projectName:'Legend Ball X1000',stage:{width:1080,height:1920},math:{grid_columns:6,grid_rows:5,paytable:{ruby:[0,0,8]},weights:{ruby:15}},tracks:[{id:'music',volume:60}],layers:[{id:'logo',name:'Logo',kind:'image',asset:'legend-v10/logo.webp',x:260,y:140,w:695,h:300,opacity:100,visible:true,locked:false,rotate:0,z:8,parallax:{x:5,y:3},motion:{src:'legend-v10/energy-720.mp4',loop:true}},{id:'reels',name:'Reels',kind:'grid',x:66,y:637,w:948,h:790,opacity:100,visible:true,locked:false}]});

test('Legend editor changes use native coordinates and preserve engine configuration',()=>{
 const source=fixture(),original=structuredClone(source),draft=importLegendLayout(source);
 draft.layers[0].mobile.x+=12;draft.layers[0].opacity=80;draft.layers[0].visible=false;
 draft.economy.reels=3;draft.economy.targetRtp=1;
 const exported=exportLegendLayout(draft);
 assert.equal(exported.layers[0].x,293.23);assert.equal(exported.layers[0].opacity,80);assert.equal(exported.layers[0].visible,false);
 assert.deepEqual(exported.math,original.math);assert.deepEqual(source,original);
 assert.deepEqual(exported.layers[0].motion,original.layers[0].motion);assert.deepEqual(exported.layers[0].parallax,original.layers[0].parallax);
});
test('Resized six by five reels retain square cells in the game',()=>{
 const draft=importLegendLayout(fixture());draft.layers[1].mobile.width=900*LEGEND_SCALE;draft.layers[1].mobile.height=400;
 const reels=exportLegendLayout(draft).layers[1];assert.equal(reels.w/6,reels.h/5);
});
test('Legend import rejects unrelated and non-virtual projects',()=>{
 assert.throws(()=>importLegendLayout({...fixture(),virtualCreditsOnly:false}));assert.throws(()=>importLegendLayout({...fixture(),stage:{width:960,height:540}}));
});

test('Total Bet controls move and resize with their panel across native export',async()=>{
 const {patchLegendLayer}=await import('../src/legendLink.js');
 const source=fixture();
 source.layers.push(
  {id:'betpanel',kind:'image',asset:'legend-v12/bet-frame.webp',x:555,y:1580,w:503,h:120,visible:true},
  {id:'minusbtn',kind:'circle',x:576,y:1590,w:100,h:100,visible:true,locked:true},
  {id:'plusbtn',kind:'circle',x:936,y:1590,w:100,h:100,visible:true,locked:true},
  {id:'betlabel',kind:'text',x:681,y:1597,w:250,h:82,visible:true,locked:true});
 const original=structuredClone(source),draft=importLegendLayout(source);
 const panel=draft.layers.find(l=>l.id==='betpanel');
 const changed=patchLegendLayer(draft,'betpanel',{mobile:{...panel.mobile,x:400*LEGEND_SCALE,y:1500*LEGEND_SCALE,width:603.6*LEGEND_SCALE,height:144*LEGEND_SCALE}});
 const exported=exportLegendLayout(changed),p=exported.layers.find(l=>l.id==='betpanel');
 for(const id of ['minusbtn','plusbtn','betlabel']){
  const l=exported.layers.find(l=>l.id===id),before=source.layers.find(l=>l.id===id);
  assert(Math.abs(l.x-(400+(before.x-555)*1.2))<.011);
  assert(Math.abs(l.y-(1500+(before.y-1580)*1.2))<.011);
  assert.equal(l.w,before.w*1.2);assert.equal(l.locked,true);
  assert(l.x>=p.x&&l.y>=p.y&&l.x+l.w<=p.x+p.w&&l.y+l.h<=p.y+p.h);
 }
 assert.deepEqual(source,original);assert.deepEqual(exported.math,original.math);
 assert.deepEqual(exported.layers[0],exportLegendLayout(draft).layers[0]);
});

test('Generic Studio edits do not group unrelated bet controls',async()=>{
 const {patchLegendLayer}=await import('../src/legendLink.js');
 const draft={layers:[{id:'betpanel',x:1,y:2,width:3,height:4},{id:'plusbtn',x:6,y:8}]};
 const changed=patchLegendLayer(draft,'betpanel',{x:100});
 assert.equal(changed.layers[0].x,100);assert.equal(changed.layers[1],draft.layers[1]);
});

test('Loading V12 handles no release and preserves old live settings during visual migration',async()=>{
 const {selectLegendSource}=await import('../src/legendLink.js');
 const template={...fixture(),grid:Array(30).fill('crown'),presentation:'legend-raster-v2'};
 template.layers.push({id:'betpanel',asset:'legend-v12/bet-frame.webp'});
 assert.equal(selectLegendSource(template,null),template);
 const released={...fixture(),bet:50,credit:1234,audio:{master:33},math:{grid_columns:6,grid_rows:5,symbol_weights:{ruby:27}}};
 const original=structuredClone(released),draft=selectLegendSource(template,released);
 assert.deepEqual(draft.math,released.math);assert.deepEqual(draft.audio,released.audio);assert.equal(draft.bet,50);assert.equal(draft.credit,1234);
 assert.deepEqual(draft.layers,template.layers);assert.notEqual(draft.layers,template.layers);assert.deepEqual(released,original);
 assert.equal(selectLegendSource(template,draft),draft);
});
