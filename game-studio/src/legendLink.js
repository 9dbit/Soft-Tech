// Adapter for the existing Skygate-derived Legend renderer. Math is read-only.
export const LEGEND_SCALE = 390 / 1080;
const BET_CHILDREN=new Set(['minusbtn','plusbtn','betlabel']);

export function selectLegendSource(template,released){
  if(!released)return template;
  if(released.layers?.some(l=>l.id==='betpanel'&&l.asset==='legend-v12/bet-frame.webp'))return released;
  // Bring the old live settings into the new visual draft without changing
  // paytables, weights, audio, credit or bet. The live snapshot stays immutable.
  return {...released,presentation:template.presentation,stage:template.stage,
    layers:structuredClone(template.layers),grid:[...template.grid],ui:{...template.ui}};
}

// Keep the three live controls inside the frame while moving or resizing it.
export function patchLegendLayer(project,id,changes){
  const panel=project.layers.find(l=>l.id===id);
  if(!panel)return project;
  const group=project.linked&&id==='betpanel'&&panel.native?.asset==='legend-v12/bet-frame.webp';
  const before=panel.mobile||panel,next={...before,...changes.mobile};
  const resize=group&&changes.mobile&&before.width>0&&before.height>0&&next.width>0&&next.height>0;
  if(changes.mobile&&(next.width<=0||next.height<=0))return project;
  return {...project,layers:project.layers.map(l=>{
    if(l.id===id)return {...l,...changes};
    if(!resize||!BET_CHILDREN.has(l.id))return l;
    const r=l.mobile||l,sx=next.width/before.width,sy=next.height/before.height;
    return {...l,mobile:{x:next.x+(r.x-before.x)*sx,y:next.y+(r.y-before.y)*sy,width:r.width*sx,height:r.height*sy}};
  })};
}
export function importLegendLayout(source, assets = []) {
  if(source?.schema!=='skygate/studio-v0.3'||source.virtualCreditsOnly!==true||source.stage?.width!==1080||source.stage?.height!==1920||!Array.isArray(source.layers))throw Error('Unsupported Legend layout');
  return {
    name:source.projectName,
    canvas:{device:'mobile',grid:'clean',background:'#181920',gridSize:24,gridOpacity:20,zoom:75,snap:false},
    layers:source.layers.map(l=>{const rect={x:l.x*LEGEND_SCALE,y:l.y*LEGEND_SCALE,width:l.w*LEGEND_SCALE,height:l.h*LEGEND_SCALE};return {id:l.id,name:l.name,type:l.kind==='grid'?'reels':l.kind==='text'?'text':'image',...rect,mobile:{...rect},opacity:l.opacity,visible:l.visible,locked:l.locked,fill:l.color||'#ffffff',text:l.text||'',native:structuredClone(l)};}),
    audio:source.tracks.map(t=>({id:t.id,name:t.name,volume:t.volume,muted:false})),
    economy:{reels:6,rows:5,paylines:1,targetRtp:source.targetRTP||96.5,minBet:.2,maxBet:300},
    brand:{name:source.projectName,shortName:'Legend Ball',description:'XDPLAY · Virtual Play',themeColor:'#110b21',backgroundColor:'#110b21',publicUrl:''},
    linked:{schema:'legend.layout-link.v1',source:structuredClone(source),assets,renderer:'/studio/editor-preview/'},
  };
}
export function exportLegendLayout(project) {
  if(project?.linked?.schema!=='legend.layout-link.v1')throw Error('Not a linked Legend project');
  const source=structuredClone(project.linked.source);
  source.layers=project.layers.map(l=>{
    if(!l.native)throw Error('Select an asset from the Legend library to add a layer');
    const r=l.mobile||l,round=n=>Math.round(n/LEGEND_SCALE*100)/100;
    return {...l.native,id:l.id,name:l.name,x:round(r.x),y:round(r.y),w:round(r.width),h:l.id==='reels'?round(r.width)*5/6:round(r.height),opacity:l.opacity,visible:l.visible,locked:l.locked,text:l.text||'',...(l.native.kind==='text'?{color:l.fill}:{})};
  });
  source.tracks=source.tracks.map(t=>({...t,volume:project.audio.find(a=>a.id===t.id)?.volume??t.volume}));
  return source;
}
