import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {brandedFiles,publicCopy} from '../scripts/rebrand-xdplay-ui.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),base='3fe2e048cb1d177b54d361a5e24f8205492bd89a';
const original=path=>execFileSync('git',['show',base+':'+path],{cwd:root});
test('provider branding changes only approved human-readable strings',()=>{
 for(const path of brandedFiles){const expected=publicCopy(original(path).toString()),actual=readFileSync(resolve(root,path),'utf8');assert.equal(actual,expected,path);assert.doesNotMatch(actual,/\bsoft tech\b/i,path);}
 assert.match(readFileSync(resolve(root,brandedFiles[0]),'utf8'),/<title>XDPLAY/);
});
test('wallet, sessions, MFA, database, release gates and server remain byte-identical',()=>{
 const paths=execFileSync('git',['ls-tree','-r','--name-only',base,'provider-dashboard/lib'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>p!=='provider-dashboard/lib/docs.mjs');
 paths.push('provider-dashboard/server.mjs','provider-dashboard/package.json','provider-dashboard/Dockerfile','provider-dashboard/public/style.css','provider-dashboard/public/core.css');
 for(const path of paths)assert.deepEqual(readFileSync(resolve(root,path)),original(path),path);
});
test('existing protocol and credential identifiers are never renamed by display migration',()=>{
 const sample='softtech.v2 softtech.wallet.v2 X-SoftTech-Version X-Wallet-Audience stp_session CORE_DEPLOYMENT_ID softtech_launch';assert.equal(publicCopy(sample),sample);
 const image=readFileSync(resolve(root,'provider-dashboard/public/logo.png'));assert.equal(image.subarray(1,4).toString(),'PNG');assert.equal(image.readUInt32BE(16),740);assert.equal(image.readUInt32BE(20),200);
});
