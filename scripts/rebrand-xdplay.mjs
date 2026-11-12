import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const glyphs = {
 X:['10001','10001','01010','00100','01010','10001','10001'],D:['11110','10001','10001','10001','10001','10001','11110'],
 P:['11110','10001','10001','11110','10000','10000','10000'],L:['10000','10000','10000','10000','10000','10000','11111'],
 A:['01110','10001','10001','11111','10001','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100']
};
export function wordmarkSvg(){
 const rects=[...'XDPLAY'].flatMap((c,i)=>glyphs[c].flatMap((row,y)=>[...row].flatMap((v,x)=>v==='1'?[`<rect x="${(i*6+x)*10+12}" y="${y*10+14}" width="10" height="10"/>`]:[]))).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 374 98" role="img" aria-label="XDPLAY"><title>XDPLAY</title><g fill="#9b2fe4">${rects}</g></svg>\n`;
}
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
export function wordmarkPng(width=1200,height=630,text='XDPLAY',transparent=false){
 const scale=Math.max(1,Math.floor(Math.min(width*.84/(text.length*6-1),height*.65/7)));
 const offsetX=Math.floor((width-(text.length*6-1)*scale)/2),offsetY=Math.floor((height-7*scale)/2),scan=Buffer.alloc(height*(1+width*4));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const gx=Math.floor((x-offsetX)/scale),gy=Math.floor((y-offsetY)/scale),i=Math.floor(gx/6),col=gx%6;
  const lit=gx>=0&&gy>=0&&gy<7&&i<text.length&&col<5&&glyphs[text[i]]?.[gy][col]==='1',p=y*(1+width*4)+1+x*4;
  scan[p]=lit?195:10;scan[p+1]=lit?105:10;scan[p+2]=lit?255:15;scan[p+3]=lit||!transparent?255:0;
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
export function replacePublicBrand(text){
 return text.replace(/\bSOFT TECH\b|\bSoft Tech\b/g,'XDPLAY')
 .replace(/>SOFT(?=<)/g,'>XD').replace(/>TECH(?=<)/g,'>PLAY')
 .replace(/ST_ \/ INTERACTIVE SHOWCASE/g,'XD_ / INTERACTIVE SHOWCASE')
 .replace(/\/assets\/(?:v5\/)?soft-tech[-\w]*\.(?:png|webp|svg)/g,'/assets/xdplay-logo.svg')
 .replace(/utm_source=softtech/g,'utm_source=xdplay');
}
async function walk(dir){const entries=await readdir(dir,{withFileTypes:true});return(await Promise.all(entries.map(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]))).flat();}
export async function applyRebrand(root){
 root=resolve(root);const changed=[];
 const files=(await walk(join(root,'src'))).filter(f=>/\.tsx?$/.test(f)&&!relative(root,f).startsWith('src/app/api/'));
 for(const file of files){
  const before=await readFile(file,'utf8');let after=replacePublicBrand(before);
  if(['src/app/layout.tsx','src/app/sitemap.ts','src/app/robots.ts'].includes(relative(root,file)))after=after.replaceAll('https://soft-tech-web-production.up.railway.app','https://xd-play.com');
  if(relative(root,file)==='src/app/layout.tsx'){
   after=after.replace('icons: { icon: "/assets/xdplay-logo.svg", apple: "/assets/xdplay-logo.svg" }','icons: { icon: "/assets/xdplay-icon.png", apple: "/assets/xdplay-icon.png" }');
   after=after.replace('images: ["/assets/xdplay-logo.svg"]','siteName: "XDPLAY", images: ["/assets/xdplay-social.png"]');
  }
  if(after!==before){await writeFile(file,after);changed.push(relative(root,file));}
 }
 const assets=join(root,'public/assets');await mkdir(assets,{recursive:true});
 await writeFile(join(assets,'xdplay-logo.svg'),wordmarkSvg());await writeFile(join(assets,'xdplay-social.png'),wordmarkPng());await writeFile(join(assets,'xdplay-icon.png'),wordmarkPng(180,180,'XD'));
 const pkgPath=join(root,'package.json'),pkg=JSON.parse(await readFile(pkgPath,'utf8'));pkg.name='xdplay-portal';await writeFile(pkgPath,JSON.stringify(pkg,null,2)+'\n');
 const lockPath=join(root,'scripts/verify-ui-lock.mjs');
 try{let lock=await readFile(lockPath,'utf8');for(const file of changed){const bytes=await readFile(join(root,file)),hash=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),escaped=file.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');lock=lock.replace(new RegExp('("'+escaped+'": ")[a-f0-9]{40}("[,\\n])'),'$1'+hash+'$2');}await writeFile(lockPath,lock);}catch(error){if(error.code!=='ENOENT')throw error;}
 return changed;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify({brand:'XDPLAY',changed:await applyRebrand(process.cwd())},null,2));
