import test from "node:test";
import assert from "node:assert/strict";
import { validateFactoryImport } from "../src/factoryImport.js";

export function makeFactoryDraft({reels=6,rows=5}={}) {
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="12" fill="#ad66ff"/></svg>';
  const data='data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
  const symbolIds=["A","K","Q","J","WILD","SCATTER"];
  const paylines=[[...Array(reels)].map(() => 0),[...Array(reels)].map(() => 1)];
  return {
    name:"NEON DRAGON",
    canvas:{device:"desktop",grid:"dots",background:"#23252a",gridSize:24,gridOpacity:28,zoom:75,snap:false},
    layers:[
      {id:"background",name:"Backdrop",type:"background",x:0,y:0,width:960,height:540,opacity:100,visible:true,locked:true,fill:"#101324"},
      {id:"reels",name:"Slot Reels",type:"reels",x:135,y:120,width:690,height:300,opacity:100,visible:true,locked:false,fill:"#14172b"}
    ],
    audio:[{id:"spin",name:"Spin / Reel",volume:0,muted:true}],
    economy:{minBet:2,maxBet:2,paylines:paylines.length,reels,rows,targetRtp:null},
    brand:{name:"NEON DRAGON",shortName:"Neon Dragon",description:"Demo game",publicUrl:"",color:"#ad66ff",background:"#0b0b17",release:"sandbox"},
    factory:{
      schemaVersion:"softtech.studio.import.v1",gameId:"neon-dragon",sourceGameVersion:"0.1.0",
      symbolIds,symbolAssets:Object.fromEntries(symbolIds.map(id=>[id,data])),
      mathBinding:"demo-only",releaseDecision:"BLOCKED",
      configuration:{reels,rows,paylines,
        reelStrips:Array.from({length:reels},()=>["A","K","Q","J","WILD","SCATTER","A","Q", "K"])}
    }
  };
}

test("valid factory import keeps 6x5 layout, editable scene and distinct assets",()=>{
  const original=makeFactoryDraft();
  const imported=validateFactoryImport(JSON.stringify(original));
  assert.equal(imported.name,"NEON DRAGON");
  assert.equal(imported.factory.releaseDecision,"BLOCKED");
  assert.equal(imported.economy.reels,6);
  assert.equal(imported.economy.rows,5);
  assert.deepEqual(Object.keys(imported.factory.symbolAssets).sort(),original.factory.symbolIds.slice().sort());
  assert.notStrictEqual(imported,original);
});

test("5x3 import works without resetting original factory layout",()=>{
  const original=makeFactoryDraft({reels:5,rows:3});
  const imported=validateFactoryImport(original);
  assert.equal(imported.economy.reels,5);
  assert.equal(imported.economy.rows,3);
});

test("malformed or spoofed factory package is blocked",()=>{
  const checks=[
    x=>{x.factory.releaseDecision="READY"},
    x=>{x.factory.mathBinding="live-wallet"},
    x=>{x.factory.symbolIds.push("A")},
    x=>{x.factory.configuration.rows=999},
    x=>{x.factory.configuration.paylines[0]=[1,2,3]},
    x=>{x.factory.configuration.reelStrips[0][0]="UNKNOWN"},
    x=>{x.layers[0].width=0},
    x=>{x.layers[0].type="script"},
    x=>{x.canvas.grid="execute"},
  ];
  for (const change of checks) {
    const bad=makeFactoryDraft();
    change(bad);
    assert.throws(()=>validateFactoryImport(bad));
  }
});

test("active SVG content and remote images are rejected",()=>{
  const bad=makeFactoryDraft();
  bad.factory.symbolAssets.A='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  assert.throws(()=>validateFactoryImport(bad),/active content/);
  const external=makeFactoryDraft();
  external.layers.push({id:"hack",name:"remote",type:"image",x:1,y:1,width:10,height:10,src:"https://unknown.example.com/run.svg"});
  assert.throws(()=>validateFactoryImport(external),/External image/);
});

test("import ignores arbitrary giant input and malformed JSON",()=>{
  assert.throws(()=>validateFactoryImport(' '.repeat(1024*1024+1)),/1 MB/);
  assert.throws(()=>validateFactoryImport('{broken'),/Invalid Game Factory JSON/);
});
