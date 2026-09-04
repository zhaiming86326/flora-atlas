import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const sharp=require('sharp');
const root=path.resolve(import.meta.dirname,'../public');
const media=JSON.parse(await fs.readFile(path.join(root,'media.json'),'utf8'));
for(const [slug,m]of Object.entries(media)){
 const source=path.join(root,m.path);const target='assets/'+slug+'.webp';
 await sharp(source).rotate().resize({width:slug.startsWith('adiantum')?1300:850,withoutEnlargement:true}).webp({quality:84}).toFile(path.join(root,target));
 m.path=target;
 await fs.unlink(source);
}
await fs.writeFile(path.join(root,'media.json'),JSON.stringify(media,null,2));
const images=await Promise.all(Object.entries(media).map(async([slug,m],i)=>({input:await sharp(path.join(root,m.path)).resize(240,180,{fit:'cover'}).toBuffer(),left:(i%4)*240,top:Math.floor(i/4)*180})));
await sharp({create:{width:960,height:540,channels:3,background:'#ffffff'}}).composite(images).png().toFile(path.resolve(root,'../../contact-sheet.png'));
console.log('Optimized',images.length,'photos');
