export const normalized = text => String(text ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
export function searchPlants(plants, state) {
 const tokens = normalized(state.q).split(' ').filter(Boolean);
 const matches = plants.filter(p => {
  const haystack = normalized([p.scientificName,p.authorship,...p.commonNames.map(n=>n.name),...p.synonyms.map(n=>n.name),p.genus.name,p.genus.zh,p.family.name,p.family.zh].join(' '));
  return tokens.every(t=>haystack.includes(t)) && (!state.group || p.group===state.group) && (!state.family || p.family.name===state.family) && (!state.genus || p.genus.name===state.genus) && (!state.use || p.useCategories.includes(state.use));
 });
 return matches.sort((a,b) => state.sort==='latin' ? a.scientificName.localeCompare(b.scientificName,'en') : state.sort==='zh' ? a.commonNames[0].name.localeCompare(b.commonNames[0].name,'zh-CN') : a.displayOrder-b.displayOrder);
}
export function paginate(items,page=1,pageSize=6) {
 const pages=Math.max(1,Math.ceil(items.length/pageSize));
 const safePage=Math.max(1,Math.min(pages,Number.isFinite(page)?Math.trunc(page):1));
 return {items:items.slice((safePage-1)*pageSize,safePage*pageSize),page:safePage,pages,total:items.length};
}
export class DemoPlantRepository {
 async load(){
  const responses=await Promise.all([fetch('data.json'),fetch('media.json')]);
  if(responses.some(r=>!r.ok))throw Error('示例数据暂时无法载入');
  [this.data,this.media]=await Promise.all(responses.map(r=>r.json()));
  return this;
 }
 query(state){return searchPlants(this.data.plants,state)}
 get(slug){return this.data.plants.find(p=>p.slug===slug)}
}
