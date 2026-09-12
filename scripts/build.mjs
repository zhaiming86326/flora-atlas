import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await fs.rm(path.join(root,'dist'),{recursive:true,force:true});
const assetsPath=path.join(root,'public','assets');
await fs.cp(path.join(root,'public'),path.join(root,'dist'),{
 recursive:true,
 filter:source=>source!==assetsPath&&!source.startsWith(assetsPath+path.sep)
});
console.log('Built static site in dist/');
