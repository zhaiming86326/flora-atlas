import fs from 'node:fs';import assert from 'node:assert/strict';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../public');
const data=JSON.parse(fs.readFileSync(path.join(root,'data.json'))),media=JSON.parse(fs.readFileSync(path.join(root,'media.json')));
const summary=JSON.parse(fs.readFileSync(path.join(root,'summary.json'))),list=JSON.parse(fs.readFileSync(path.join(root,'plant-list.json')));
assert.equal(data.plants.length,data.dataset.recordCount);
assert.equal(summary.stats.plants,data.plants.length);
assert.equal(summary.stats.species,data.plants.length);
assert.equal(summary.families.length,new Set(data.plants.map(p=>p.family.name)).size);
assert.equal(list.plants.length,data.plants.length);
assert.equal(new Set(data.plants.map(p=>p.id)).size,data.plants.length);
for(const p of data.plants){assert(p.scientificName&&p.commonNames[0].name&&p.family.name&&p.genus.name);assert(data.groups.some(g=>g.id===p.group));assert(p.sourceRecords.every(s=>s.sourceUrl.startsWith('https://')&&s.licenseId&&s.datasetVersion&&s.retrievedAt));assert(p.uses.every(u=>u.referenceUrl&&u.licenseId));const m=media[p.mediaId];assert(m?.creator&&m.license&&m.licenseUrl&&m.sourceUrl);assert(fs.existsSync(path.join(root,m.path)));assert(fs.existsSync(path.join(root,'plant-details',p.slug+'.json')));assert(!JSON.stringify(p).includes('undefined'));assert.equal(p.externalIds.wfo,null);assert.equal(p.externalIds.wcvp,null)}
for(const f of ['index.html','app.js','domain.js','navigation.js','style.css','desktop.css','architecture.md','schema.wcvp.sql'])assert(fs.existsSync(path.join(root,f)),f);
assert(fs.existsSync(path.resolve(import.meta.dirname,'../worker/index.js')),'worker/index.js');
console.log('Validated',data.plants.length,'records, source fields, references, licensed assets and deployable files.');
