export const normalized = text => String(text ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
export const CLOUD_API_BASE = 'https://flora-atlas-api.mingming86326.workers.dev';
const lifeformTerms={tree:['tree','乔木'],shrub:['shrub','subshrub','灌木','亚灌木'],herb:['herb','annual','biennial','perennial','geophyte','helophyte','草本'],climber:['climber','liana','vine','藤本'],wetland:['aquatic','helophyte','hydrophyte','水生','湿生'],epiphyte:['epiphyte','附生'],annual:['annual','一年生'],perennial:['perennial','多年生']};
const zhCollator = new Intl.Collator('zh-CN-u-co-pinyin');
const latinCollator = new Intl.Collator('en');
const firstZh = p => p.chineseName || p.commonNames?.[0]?.name || '';
const latinName = p => p.canonicalName || p.scientificName || '';
export function searchPlants(plants, state) {
 const tokens = normalized(state.q).split(' ').filter(Boolean);
 const lifeforms = state.lifeforms || [];
 const matches = plants.filter(p => {
  const haystack = normalized([p.scientificName,p.authorship,...p.commonNames.map(n=>n.name),...p.synonyms.map(n=>n.name),p.genus.name,p.genus.zh,p.family.name,p.family.zh].join(' '));
  const lifeformText = normalized([p.lifeform,p.habit,p.tagline].join(' '));
  return tokens.every(t=>haystack.includes(t)) && (!lifeforms.length || lifeforms.some(v=>(lifeformTerms[v]||[v]).some(term=>lifeformText.includes(term)))) && (!state.family || p.family.name===state.family) && (!state.genus || p.genus.name===state.genus) && (!state.use || p.useCategories.includes(state.use));
 });
 return matches.sort((a,b) => {
  if (state.sort === 'latin') return latinCollator.compare(latinName(a), latinName(b));
  const az = firstZh(a);
  const bz = firstZh(b);
  if (az && bz) return zhCollator.compare(az, bz) || latinCollator.compare(latinName(a), latinName(b));
  if (az) return -1;
  if (bz) return 1;
  return latinCollator.compare(latinName(a), latinName(b));
 });
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

export class PlantApiRepository {
 constructor(base=CLOUD_API_BASE){this.base=base;this.detailCache=new Map()}
 async getJSON(path){
  const response=await fetch(this.base+path);
  if(!response.ok){
   let detail = {};
   try { detail = await response.json(); } catch {}
   const message = detail.code === 'D1_DAILY_READ_LIMIT'
    ? detail.error
    : '云端植物数据暂时无法载入';
   throw Error(message);
  }
  return response.json();
 }
 async loadSummary(){return this.getJSON('/api/summary')}
 async query(state){
  const params=new URLSearchParams();
  for(const key of ['q','family','sort'])if(state[key])params.set(key,state[key]);
  if(state.lifeforms?.length)params.set('lifeform',state.lifeforms.join(','));
  params.set('limit',String(state.pageSize||24));
  params.set('offset',String(((state.page||1)-1)*(state.pageSize||24)));
  return this.getJSON('/api/plants?'+params);
 }
 async get(slug){
  if(!this.detailCache.has(slug))this.detailCache.set(slug,this.getJSON('/api/plants/'+encodeURIComponent(slug)).then(data=>data.item));
  return this.detailCache.get(slug);
 }
}

export class StaticPagedRepository {
 async getJSON(path){
  const response=await fetch(path.replace(/^\//,''));
  if(!response.ok)throw Error('示例数据暂时无法载入');
  return response.json();
 }
 async loadSummary(){
  this.summary=await this.getJSON('summary.json');
  return this.summary;
 }
 async loadList(){
  if(!this.list)this.list=await this.getJSON('plant-list.json');
  return this.list;
 }
 async query(state){
  const list=await this.loadList();
  const found=searchPlants(list.plants,state);
  const page=paginate(found,state.page,state.pageSize||24);
  const pageSize=state.pageSize||24;
  return {
   items:page.items,
   total:page.total,
   page:page.page,
   pageSize,
   pages:page.pages,
   offset:(page.page-1)*pageSize,
   hasPrev:page.page>1,
   hasNext:page.page<page.pages,
   prevOffset:page.page>1?(page.page-2)*pageSize:null,
   nextOffset:page.page<page.pages?page.page*pageSize:null
  };
 }
 async get(slug){
  const data=await this.getJSON('plant-details/'+encodeURIComponent(slug)+'.json');
  return {...data.plant,media:data.media,imageUrl:data.plant.imageUrl||data.media?.path};
 }
}
