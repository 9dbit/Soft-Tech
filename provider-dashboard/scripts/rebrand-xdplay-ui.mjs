import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {wordmarkPng} from '../../scripts/rebrand-xdplay.mjs';
export const brandedFiles=['provider-dashboard/public/index.html','provider-dashboard/public/app.js','provider-dashboard/public/staff.js','provider-dashboard/lib/docs.mjs'];
export function publicCopy(source){return source.replace(/\bSOFT TECH\b|\bSoft Tech\b|\bsoft tech\b/g,'XDPLAY').replace('ST<span> / </span>PANEL','XD<span> / </span>PANEL');}
export async function applyProviderBrand(root=process.cwd()){
 const changed=[];
 for(const path of brandedFiles){const file=resolve(root,path),before=await readFile(file,'utf8'),after=publicCopy(before);if(before!==after){await writeFile(file,after);changed.push(path);}}
 await writeFile(resolve(root,'provider-dashboard/public/logo.png'),wordmarkPng(740,200,'XDPLAY',true));return changed;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify({brand:'XDPLAY',scope:'provider display copy and logo only',changed:await applyProviderBrand()},null,2));
