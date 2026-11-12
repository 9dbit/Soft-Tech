import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';
import {replacePublicBrand,wordmarkSvg,wordmarkPng,applyRebrand} from './rebrand-xdplay.mjs';
test('public copy and logo references change without modifying protocol identifiers',()=>{
 assert.equal(replacePublicBrand('SOFT TECH | Soft Tech | softtech.v2 | X-SoftTech-Version | softtech_launch'),'XDPLAY | XDPLAY | softtech.v2 | X-SoftTech-Version | softtech_launch');
 assert.equal(replacePublicBrand('<span>SOFT</span><span>TECH</span>'),'<span>XD</span><span>PLAY</span>');
 assert.equal(replacePublicBrand('/assets/soft-tech-logo.png /assets/v5/soft-tech-neon-header.webp'),'/assets/xdplay-logo.svg /assets/xdplay-logo.svg');
 assert.equal(replacePublicBrand('https://uno-luck.example/?utm_source=softtech'),'https://uno-luck.example/?utm_source=xdplay');
});
test('wordmark has accessible identity and valid PNG scanlines',()=>{
 assert.match(wordmarkSvg(),/<title>XDPLAY<\/title>/);const png=wordmarkPng(180,180,'XD');assert.equal(png.readUInt32BE(16),180);assert.equal(png.readUInt32BE(20),180);let at=8;const parts=[];
 while(at<png.length){const len=png.readUInt32BE(at);if(png.toString('ascii',at+4,at+8)==='IDAT')parts.push(png.subarray(at+8,at+8+len));at+=12+len;}assert.equal(inflateSync(Buffer.concat(parts)).length,180*(1+180*4));
});
test('migration is repeatable and excludes backend and historical evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'xdplay-brand-'));
 try{await mkdir(join(dir,'src/app/api/health'),{recursive:true});await mkdir(join(dir,'docs'),{recursive:true});
 await writeFile(join(dir,'src/app/page.tsx'),'<main>SOFT TECH <span>SOFT</span><span>TECH</span></main>');
 await writeFile(join(dir,'src/app/api/health/route.ts'),'export const id="soft-tech"; // Soft Tech stable API identity');
 await writeFile(join(dir,'docs/history.md'),'Soft Tech historical checkpoint');await writeFile(join(dir,'package.json'),'{"name":"soft-tech-portal","scripts":{"build":"next build"}}');
 assert.deepEqual(await applyRebrand(dir),['src/app/page.tsx']);const before=await readFile(join(dir,'src/app/page.tsx'),'utf8');assert.deepEqual(await applyRebrand(dir),[]);assert.equal(await readFile(join(dir,'src/app/page.tsx'),'utf8'),before);
 assert.match(await readFile(join(dir,'src/app/api/health/route.ts'),'utf8'),/Soft Tech stable/);assert.equal(await readFile(join(dir,'docs/history.md'),'utf8'),'Soft Tech historical checkpoint');
 }finally{await rm(dir,{recursive:true,force:true});}
});
