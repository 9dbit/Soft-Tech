import { test, expect } from "@playwright/test";

function pilotProject() {
  const raw = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="12" fill="#ad66ff"/></svg>';
  const asset = "data:image/svg+xml;base64,"+Buffer.from(raw,"utf8").toString("base64");
  const symbols=["A","K","Q","J","WILD","SCATTER"];
  return {
    name:"NEON DRAGON",
    canvas:{device:"desktop",grid:"dots",background:"#23252a",gridSize:24,gridOpacity:28,zoom:75,snap:false},
    layers:[
      {id:"background",name:"Backdrop",type:"background",x:0,y:0,width:960,height:540,opacity:100,visible:true,locked:true,fill:"#0b0b17"},
      {id:"heading",name:"Game Title",type:"text",x:285,y:30,width:390,height:70,opacity:100,visible:true,locked:false,fill:"#ffffff",text:"NEON DRAGON"},
      {id:"reels",name:"Slot Reels",type:"reels",x:145,y:125,width:670,height:300,opacity:100,visible:true,locked:false,fill:"#201c32"},
      {id:"spin",name:"Spin Button",type:"button",x:410,y:448,width:145,height:65,opacity:100,visible:true,locked:false,fill:"#ad66ff",text:"SPIN"},
    ],
    audio:[{id:"spin",name:"Spin",volume:0,muted:true}],
    economy:{minBet:20,maxBet:20,paylines:20,reels:6,rows:5,targetRtp:null},
    brand:{name:"NEON DRAGON",shortName:"Neon Dragon",description:"Original virtual credit game",publicUrl:"",color:"#ad66ff",background:"#0b0b17",release:"sandbox"},
    factory:{
      schemaVersion:"softtech.studio.import.v1",gameId:"neon-dragon",sourceGameVersion:"0.1.0",
      symbolIds:symbols,symbolAssets:Object.fromEntries(symbols.map(x=>[x,asset])),
      mathBinding:"demo-only",releaseDecision:"BLOCKED",
      configuration:{reels:6,rows:5,
        paylines:Array.from({length:20},(_,i)=>Array.from({length:6},(_,col)=>(i+col)%5)),
        reelStrips:Array.from({length:6},()=>["A","K","Q","J","WILD","SCATTER","A","K","J"])
      }
    }
  };
}

test("Game Factory 6x5 import opens independent symbol SVG assets and keeps math locked", async({page})=>{
  await page.goto("/");
  page.on("dialog", async d=>d.accept());
  await page.getByRole("button",{name:"Import Game Factory"}).click();
  const project=pilotProject();
  await page.locator('input[aria-label="Factory project JSON"]').setInputFiles({
    name:"studio.project.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(project),"utf8")
  });
  await expect(page.getByText(/Imported NEON DRAGON as an editable demo draft/)).toBeVisible();
  await expect(page.locator(".reel-wrap")).toHaveAttribute("data-reels","6");
  await expect(page.locator(".reel-wrap")).toHaveAttribute("data-rows","5");
  await expect(page.locator(".reel-cell img.factory-reel-symbol")).toHaveCount(30);
  await page.getByRole("button",{name:"Assets"}).click();
  await expect(page.locator(".factory-symbol-card")).toHaveCount(6);
  await expect(page.getByRole("img",{name:"Factory asset WILD"})).toBeVisible();
  await page.getByRole("button",{name:"Economy Lab"}).click();
  await expect(page.getByText(/RELEASE BLOCKED/)).toBeVisible();
  await expect(page.getByRole("spinbutton",{name:"Reels"})).toBeDisabled();
  await expect(page.getByRole("spinbutton",{name:"Rows"})).toBeDisabled();
  await expect(page.getByRole("spinbutton",{name:"Paylines"})).toBeDisabled();
  await page.reload();
  await expect(page.locator(".reel-cell img.factory-reel-symbol")).toHaveCount(30);
  await expect(page.locator(".reel-wrap")).toHaveAttribute("data-reels","6");
});

test("Factory refuses forged release state instead of replacing current draft", async({page})=>{
  await page.goto("/");
  const original=await page.locator(".project-chip").textContent();
  const bad=pilotProject();
  bad.factory.releaseDecision="CERTIFIED";
  await page.getByRole("button",{name:"Import Game Factory"}).click();
  await page.locator('input[aria-label="Factory project JSON"]').setInputFiles({
    name:"malicious.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(bad),"utf8")
  });
  await expect(page.getByText(/Import rejected:/)).toBeVisible();
  await expect(page.locator(".project-chip")).toHaveText(original.trim());
});
