import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const sha = data => createHash("sha256").update(data).digest("hex");
const symbolNames = ["A","K","Q","J","WILD","SCATTER"];
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const label = Buffer.from(type);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(crc32(Buffer.concat([label,bytes])));
  return Buffer.concat([header,label,bytes,trailer]);
}
function png128(opaque = false, tint = 0) {
  const w = 128, h = 128, rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w * 4 + 1);
    for (let x = 0; x < w; x++) {
      const offset = 1 + x * 4;
      row[offset] = (x*3 + tint*37) & 255;
      row[offset+1] = (y*2 + tint*23) & 255;
      row[offset+2] = (x + y + tint*51) & 255;
      row[offset+3] = opaque || (x>15 && x<110 && y>15 && y<110) ? 255 : 0;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4);
  ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a","hex"),
    chunk("IHDR",ihdr), chunk("IDAT",deflateSync(Buffer.concat(rows))),
    chunk("IEND",Buffer.alloc(0)),
  ]);
}
function project() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="12" fill="#7ad4ef"/></svg>';
  const symbol = "data:image/svg+xml;base64,"+Buffer.from(svg).toString("base64");
  const reels=6, rows=5;
  return {
    name:"NEON DRAGON",
    canvas:{device:"desktop",grid:"dots",background:"#23252a",gridSize:24,gridOpacity:28,zoom:75,snap:false},
    layers:[
      {id:"background",name:"Backdrop",type:"background",x:0,y:0,width:960,height:540,opacity:100,visible:true,locked:true,fill:"#0b0b17"},
      {id:"heading",name:"Title",type:"text",x:300,y:25,width:360,height:70,opacity:100,visible:true,locked:false,fill:"#fff2b5",text:"NEON DRAGON"},
      {id:"reels",name:"Reels",type:"reels",x:140,y:120,width:680,height:300,opacity:100,visible:true,locked:false,fill:"#10132b"},
    ],
    audio:[],economy:{reels,rows,paylines:2,minBet:2,maxBet:2,targetRtp:null},
    brand:{name:"NEON DRAGON",shortName:"Neon Dragon",description:"Test demo",publicUrl:"",color:"#a178f6",background:"#09041c",release:"sandbox"},
    factory:{
      schemaVersion:"softtech.studio.import.v1",gameId:"neon-dragon",sourceGameVersion:"0.1.0",
      mathBinding:"demo-only",releaseDecision:"BLOCKED",
      symbolIds:symbolNames,symbolAssets:Object.fromEntries(symbolNames.map(id=>[id,symbol])),
      configuration:{reels,rows,paylines:[Array(reels).fill(0),Array(reels).fill(1)],
        reelStrips:Array.from({length:reels},()=>["A","K","Q","J","WILD","SCATTER","A","J"]),
      },
    },
  };
}
async function sampleZip({ tampered = false } = {}) {
  const zip = new JSZip();
  const items = [];
  for (const [index,id] of [...symbolNames,"background"].entries()) {
    const bytes = png128(id==="background",index);
    const path="assets/"+id+".png";
    zip.file(path,bytes);
    items.push({id,role:id==="background"?"background":"symbol",expectedAlpha:id!=="background",
      path,sha256:tampered && id==="A" ? "f".repeat(64):sha(bytes),
      dimensions:[128,128],sizeBytes:bytes.length});
  }
  const manifest={schemaVersion:"softtech.studio.raster-pack.v1",gameId:"neon-dragon",
    visualTier:"ART_CANDIDATE_UNAPPROVED",humanApproved:false,productionAllowed:false,
    sourceMasterSha256:sha(Buffer.from("original art reference")),assets:items};
  zip.file("art-pack.json",JSON.stringify(manifest));
  zip.file("studio.project.json",JSON.stringify(project()));
  return zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"});
}

test("Studio imports PNG/WebP candidate ZIP with real alpha and independently stored artwork",async({page})=>{
  await page.goto("/");
  page.on("dialog",dialog=>dialog.accept());
  const archive = await sampleZip();
  await page.getByRole("button",{name:"Import Art ZIP"}).click();
  await page.locator('input[aria-label="Game Factory raster artwork ZIP"]').setInputFiles({
    name:"neon-dragon-art.zip",mimeType:"application/zip",buffer:archive,
  });
  await expect(page.getByText(/Original WebP\/PNG candidate assets imported/)).toBeVisible({timeout:30000});
  await page.getByRole("button",{name:"Assets"}).click();
  await expect(page.locator(".raster-card")).toHaveCount(7);
  await expect(page.getByRole("img",{name:"Raster art WILD"})).toBeVisible();
  await page.getByRole("button",{name:"Visual Editor"}).click();
  await expect(page.locator(".reel-wrap")).toHaveAttribute("data-reels","6");
  await expect(page.locator(".reel-cell img.factory-reel-symbol")).toHaveCount(30);
  await expect(page.locator(".reel-cell img.factory-reel-symbol").first()).toHaveAttribute("src",/^blob:/);
  await page.getByRole("button",{name:"Assets"}).click();
  await page.getByRole("button",{name:"Add layer background"}).click();
  await expect(page.locator(".layer-row").filter({hasText:"Art: background"})).toHaveCount(1);
  await expect(page.getByRole("img",{name:"Art: background"})).toBeVisible();
  await page.reload();
  await expect(page.locator(".reel-cell img.factory-reel-symbol").first()).toHaveAttribute("src",/^blob:/,{timeout:15000});
  await page.getByRole("button",{name:"Economy Lab"}).click();
  await expect(page.getByText(/RELEASE BLOCKED/)).toBeVisible();
  await expect(page.getByRole("spinbutton",{name:"Reels"})).toBeDisabled();
  await expect(page.getByRole("spinbutton",{name:"Rows"})).toBeDisabled();
  await page.screenshot({path:"test-results/neon-dragon-raster-studio.png",fullPage:true});
});

test("tampered alpha artwork is rejected without replacing the previous local Studio draft",async({page})=>{
  await page.goto("/");
  const original=await page.locator(".project-chip").textContent();
  const archive=await sampleZip({tampered:true});
  page.on("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Import Art ZIP"}).click();
  await page.locator('input[aria-label="Game Factory raster artwork ZIP"]').setInputFiles({
    name:"spoofed-raster.zip",mimeType:"application/zip",buffer:archive,
  });
  await expect(page.getByText(/Raster ZIP rejected: Corrupt or modified raster: A/)).toBeVisible({timeout:15000});
  await expect(page.locator(".project-chip")).toHaveText(original.trim());
});
