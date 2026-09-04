import {createSectionNavigation} from './navigation.js';
import {DemoPlantRepository,paginate} from './domain.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={
'sprout':'M12 22v-9M12 16C3 16 3 7 3 7s9-1 9 9Zm0-5C12 2 21 2 21 2s1 9-9 9Z',
'search':'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
'arrow-right':'M4 12h16m-6-6 6 6-6 6','arrow-up-right':'M6 18 18 6M6 6h12v12','chevron-right':'m9 6 6 6-6 6','chevron-left':'m15 6-6 6 6 6','x':'m6 6 12 12M6 18 18 6',
'grid':'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z','list':'M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1',
'lock':'M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4m-4 5v2','tree':'M12 3v7M5 14v-4h14v4M2 15h6v6H2Zm14 0h6v6h-6ZM9 1h6v5H9Z',
'leaf':'M20 3C6 1 1 9 5 16c7 5 17-1 15-13ZM4 21 15 10','flower':'M12 12c-8 0-8-9-3-9 3 0 3 5 3 9Zm0 0c0-8 9-8 9-3 0 3-5 3-9 3Zm0 0c8 0 8 9 3 9-3 0-3-5-3-9Zm0 0c0 8-9 8-9 3 0-3 5-3 9-3Z',
'book-open':'M12 21c-3-3-6-3-10-3V3c4 0 7 0 10 3 3-3 6-3 10-3v15c-4 0-7 0-10 3ZM12 6v15','database':'M20 5c0 2-4 3-8 3S4 7 4 5s4-3 8-3 8 1 8 3Zm0 0v14c0 2-4 3-8 3s-8-1-8-3V5m0 7c0 2 4 3 8 3s8-1 8-3',
'globe':'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
'download':'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6','info':'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10h.01','check':'m5 12 4 4L19 6','sliders':'M4 6h5m5 0h6M4 18h10m5 0h1M9 3v6m5 6v6','copy':'M9 9h12v12H9ZM5 15H3V3h12v2','cup':'M3 4h14v12a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Zm14 2h2a3 3 0 0 1 0 6h-2','wind':'M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h5'
};
const icon=n=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n]||paths.leaf}"/></svg>`;
function icons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon))}
icons();
let repo, state={q:'',group:'',family:'',genus:'',use:'',sort:'default',page:1,view:'grid'}, expanded=new Set(['angiosperms']);
let currentPlant=null, detailTab='overview',lastHash='#catalog', toastTimer;
const navigation=createSectionNavigation(hash=>{lastHash=hash});
const USES=['观赏','食用','芳香','绿化'];
const useIcon={'观赏':'flower','食用':'cup','芳香':'wind','绿化':'leaf'};
function readURL(){const p=new URL(location.href).searchParams;for(const k of ['q','group','family','genus','use'])state[k]=p.get(k)||'';state.sort=['zh','latin'].includes(p.get('sort'))?p.get('sort'):'default';state.view=p.get('view')==='list'?'list':'grid';state.page=Math.max(1,parseInt(p.get('page')||'1',10)||1);$('#search').value=state.q;$('#sort').value=state.sort;}
function writeURL(){const url=new URL(location.href);for(const [k,v]of Object.entries(state)){if(v&&v!=='default'&&!(k==='view'&&v==='grid')&&!(k==='page'&&v===1))url.searchParams.set(k,v);else url.searchParams.delete(k)}history.replaceState(null,'',url);}
function update(patch,scroll=false){Object.assign(state,{page:1},patch);render();writeURL();if(scroll)navigation.go('explore');}
function groupName(id){return repo.data.groups.find(g=>g.id===id)?.name||id}
function familyName(id){return repo.data.plants.find(p=>p.family.name===id)?.family.zh||id}
function genusName(id){return repo.data.plants.find(p=>p.genus.name===id)?.genus.zh||id}
const tagHTML=p=>p.useCategories.map(u=>`<span class="tag" data-use="${esc(u)}">${esc(u)}</span>`).join('');
function card(p){const m=repo.media[p.mediaId],zh=p.commonNames[0].name;return `<article class="plant-card" data-slug="${p.slug}"><div class="card-photo"><a href="#plant/${p.slug}" aria-label="查看${esc(zh)}详情"><img src="${esc(m.path)}" alt="${esc(zh)}，${esc(m.alt)}" loading="lazy" width="480" height="360"></a><span class="habit-badge">${esc(p.habit)}</span><span class="card-number">${String(p.displayOrder).padStart(3,'0')}</span></div><div class="card-body"><a class="card-heading" href="#plant/${p.slug}"><h3>${esc(zh)}</h3>${icon('arrow-up-right')}</a><p class="latin-name" lang="la">${esc(p.scientificName)}</p><p class="card-taxonomy">${esc(p.family.zh)}<span>/</span>${esc(p.genus.zh)}</p><p class="tagline">${esc(p.tagline)}</p><div class="card-bottom"><div class="tags">${tagHTML(p)}</div><span class="card-source" title="名称、用途与图片来源均可在详情查看">${icon('check')}来源可溯</span></div></div></article>`}
function renderTree(){
 const all=repo.data.plants;
 $('#taxonomy-tree').innerHTML=`<button class="tree-all ${!state.group&&!state.family&&!state.genus?'is-active':''}" data-group="" aria-pressed="${!state.group&&!state.family&&!state.genus}">${icon('leaf')}全部植物<span class="count">${all.length}</span></button>`+repo.data.groups.map(g=>{
 const plants=all.filter(p=>p.group===g.id);const families=[...new Set(plants.map(p=>p.family.name))];
 return `<div class="tree-group"><div class="group-row"><button class="group-button ${state.group===g.id&&!state.family?'is-active':''}" data-group="${g.id}" aria-pressed="${state.group===g.id&&!state.family}">${esc(g.name)}<span class="count">${plants.length}</span></button><button class="expand-group" data-expand="${g.id}" aria-label="${expanded.has(g.id)?'收起':'展开'}${esc(g.name)}" aria-expanded="${expanded.has(g.id)}">${icon('chevron-right')}</button></div>${expanded.has(g.id)?`<div class="families">${families.map(f=>`<button class="family-button ${state.family===f?'is-active':''}" data-family="${f}" aria-pressed="${state.family===f}"><span>${esc(familyName(f))}<small>${f}</small></span><span class="count">${plants.filter(p=>p.family.name===f).length}</span></button>`).join('')}</div>`:''}</div>`;
 }).join('');
 const genera=[...new Set(all.filter(p=>(!state.group||p.group===state.group)&&(!state.family||p.family.name===state.family)).map(p=>p.genus.name))].sort();
 $('#genus-filter').innerHTML='<option value="">全部属</option>'+genera.map(g=>`<option value="${g}">${esc(genusName(g))} · ${g}</option>`).join('');$('#genus-filter').value=state.genus;
}
function render(){
 renderTree();const allMatches=repo.query(state);const paged=paginate(allMatches,state.page);state.page=paged.page;
 const byOthers=repo.query({...state,use:''});
 $('#use-filters').innerHTML=[['','全部植物','leaf'],...USES.map(u=>[u,u,useIcon[u]])].map(([key,label,ic])=>`<button data-use="${key}" aria-pressed="${state.use===key}">${icon(ic)}${label}<span class="pill-count">${key?byOthers.filter(p=>p.useCategories.includes(key)).length:byOthers.length}</span></button>`).join('');
 $('#result-count').innerHTML=`找到 <strong>${paged.total}</strong> 种植物 <span> / 共 ${repo.data.plants.length} 种示例</span>`;
 const filters=[['q',state.q&&'搜索：'+state.q],['group',state.group&&groupName(state.group)],['family',state.family&&familyName(state.family)],['genus',state.genus&&genusName(state.genus)],['use',state.use]];
 $('#active-filters').innerHTML=filters.filter(([,v])=>v).map(([k,v])=>`<button class="active-chip" data-clear="${k}" aria-label="移除${esc(v)}筛选">${esc(v)}${icon('x')}</button>`).join('');
 $('#results').className=`plant-grid ${state.view==='list'?'list-view':''}`;
 $('#results').innerHTML=paged.items.length?paged.items.map(card).join(''):`<div class="empty-state">${icon('search')}<h3>暂时没有找到这株植物</h3><p>当前只有 12 种示例植物。<br>试试更短的名称，或调整分类与用途筛选。</p><button data-action="reset">清除筛选，查看全部</button></div>`;
 $('#pagination').innerHTML=paged.total?`<button data-page="${paged.page-1}" aria-label="上一页" ${paged.page===1?'disabled':''}>${icon('chevron-left')}</button>${Array.from({length:paged.pages},(_,i)=>`<button data-page="${i+1}" ${paged.page===i+1?'aria-current="page"':''} aria-label="第 ${i+1} 页">${i+1}</button>`).join('')}<button data-page="${paged.page+1}" aria-label="下一页" ${paged.page===paged.pages?'disabled':''}>${icon('chevron-right')}</button><span class="page-summary">${paged.page} / ${paged.pages}</span>`:'';
 document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(state.view===b.dataset.view)));
 $('#sort').value=state.sort;
}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2600)}
function reset(){Object.assign(state,{q:'',group:'',family:'',genus:'',use:'',page:1});$('#search').value='';render();writeURL()}
function toolbar(text){return `<div class="dialog-toolbar"><div class="breadcrumbs">草木集 ${icon('chevron-right')} ${text}</div><button class="close-dialog" data-action="close" aria-label="关闭详情">${icon('x')}</button></div>`}
function showDialog(content){$('#dialog-content').innerHTML=content;if(!$('#detail-dialog').open)$('#detail-dialog').showModal();$('#detail-dialog').scrollTop=0;}
function detailContent(p){const m=repo.media[p.mediaId];return `${toolbar(`${esc(p.family.zh)} ${icon('chevron-right')} ${esc(p.commonNames[0].name)}`)}<div class="detail-top"><div><img class="detail-image" src="${esc(m.path)}" alt="${esc(p.commonNames[0].name)}"><div class="image-credit">摄影：${esc(m.creator)} · <a href="${esc(m.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(m.license)}</a><br><a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener noreferrer">原始来源</a> · ${esc(m.modifications)}</div></div><div class="detail-intro"><p class="eyebrow">PLANT PORTRAIT / ${String(p.displayOrder).padStart(3,'0')}</p><h2 id="dialog-title">${esc(p.commonNames[0].name)}</h2><p class="detail-scientific" lang="la">${esc(p.scientificName)}<small>${esc(p.authorship)}</small></p><div class="tags">${tagHTML(p)}</div><p class="description">${esc(p.description)}</p><p class="detail-alias">别名：${p.commonNames.slice(1).map(n=>esc(n.name)).join('、')||'暂未收录'}</p><div class="detail-actions"><button data-action="copy-name">${icon('copy')}复制学名</button><button data-action="copy-link">${icon('arrow-up-right')}复制详情链接</button></div></div></div><div class="detail-tabs" role="tablist" aria-label="植物资料"><button role="tab" id="tab-overview" data-tab="overview" aria-controls="detail-panel" aria-selected="${detailTab==='overview'}">植物档案</button><button role="tab" id="tab-uses" data-tab="uses" aria-controls="detail-panel" aria-selected="${detailTab==='uses'}">用途与特点</button><button role="tab" id="tab-provenance" data-tab="provenance" aria-controls="detail-panel" aria-selected="${detailTab==='provenance'}">来源与许可</button></div><div class="tab-content" role="tabpanel" id="detail-panel" aria-labelledby="tab-${detailTab}">${tabContent(p)}</div>`}
function tabContent(p){
 if(detailTab==='overview')return `<div class="detail-tree"><span>植物界</span>${icon('chevron-right')}<button data-detail-group="${p.group}">${esc(groupName(p.group))}</button>${icon('chevron-right')}<button data-detail-family="${p.family.name}">${esc(p.family.zh)}</button>${icon('chevron-right')}<button data-detail-genus="${p.genus.name}">${esc(p.genus.zh)}</button></div><div class="detail-info-grid"><div><h3>分类层级</h3><p>${esc(p.family.name)} · ${esc(p.genus.name)}<br>物种（species） / ${esc(p.habit)}</p></div><div><h3>原产或自然分布概述</h3><p>${esc(p.origin)}</p></div><div><h3>名称记录</h3><p>示例参考名 · 尚未由 WFO / WCVP 批次校验<br>稳定记录 ID：${esc(p.id)}</p></div><div><h3>已收录异名</h3><p>${p.synonyms.length?p.synonyms.map(s=>`<em>${esc(s.name)}</em> ${esc(s.authorship)}<br><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看异名来源 ↗</a>`).join('<br>'):'本示例暂未录入异名。'}</p></div></div>`;
 if(detailTab==='uses')return `<div class="detail-info-grid"><div><h3>可观察的特点</h3><p>${esc(p.features)}</p></div><div><h3>用途概述</h3><p>${esc(p.useSummary)}</p></div></div><p class="source-notice">中文内容独立编写，事实参考 <a href="${esc(p.sourceRecords[1].sourceUrl)}" target="_blank" rel="noopener noreferrer"><u>NC State Extension 植物资料 ↗</u></a>。此处记录用途，不构成采食或用药指导。</p>${p.notice?`<p class="notice">${esc(p.notice)}</p>`:''}`;
 const m=repo.media[p.mediaId],s=p.sourceRecords[0];
 return `<table class="source-table"><tbody><tr><th>名称数据</th><td><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">Wikidata / ${esc(s.recordId)} ↗</a><small>学名、命名人、主要中文名与属名 · 访问于 ${s.retrievedAt}</small></td><td><a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">CC0 1.0</a></td></tr><tr><th>中文资料</th><td>草木集 · 独立编写与事实整理<small>分类、简介、用途与别名 · 版本 demo-1.0</small><a href="${esc(p.sourceRecords[1].sourceUrl)}" target="_blank" rel="noopener noreferrer">事实参考：NC State Extension ↗</a></td><td><a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer">CC0 1.0</a></td></tr><tr><th>图片</th><td>${esc(m.creator)}<small>${esc(m.caption)} · ${esc(m.modifications)}</small><a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener noreferrer">摄影署名来源 ↗</a></td><td><a href="${esc(m.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(m.license)}</a></td></tr></tbody></table><p class="source-notice">许可按内容分别记录。参考网页的原文没有被复制，也不随本示例重新授权。WFO / WCVP / IPNI 标识暂为空，不伪造外部标识。用途尚未经专业植物学审核。</p>`;
}
function openPlant(slug){const p=repo.get(slug);if(!p){showDialog(`${toolbar('未找到')}<div class="tab-content"><h2 id="dialog-title" class="credits-title">这条植物记录尚未收录</h2><p class="architecture-intro">详情链接中的标识未出现在示例集中。</p><button class="outline-button" data-action="close">返回图鉴</button></div>`);return}currentPlant=p;detailTab='overview';showDialog(detailContent(p));}
function credits(){showDialog(`${toolbar('图片来源与许可')}<div class="tab-content"><h2 class="credits-title" id="dialog-title">每一张照片，都保留署名。</h2><p class="architecture-intro">下列图片按来源页面指定的开放许可使用。本网站进行了等比例压缩，并以裁切方式展示。</p><div class="credits-list">${repo.data.plants.map(p=>{const m=repo.media[p.mediaId];return `<article class="credit-item"><img src="${esc(m.path)}" alt="${esc(p.commonNames[0].name)}"><div><h3>${esc(p.commonNames[0].name)}</h3><p>${esc(m.creator)}</p><a href="${esc(m.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(m.license)}</a> · <a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener noreferrer">来源页面 ↗</a></div></article>`}).join('')}</div></div>`)}
function architecture(){showDialog(`${toolbar('数据结构')}<div class="tab-content"><h2 class="credits-title" id="dialog-title">从 12 株植物，到完整植物名录。</h2><p class="architecture-intro">当前使用静态示例文件，搜索直接在浏览器运行。数据访问已独立成模块；全量导入后可替换为服务端分页查询。</p><div class="schema-list"><article><h3>植物分类记录</h3><code>taxon_id · scientific_name · rank<br>parent_taxon_id · accepted_taxon_id</code><p>分类、父级与接受名关联独立保存。</p></article><article><h3>名称与异名</h3><code>vernacular_names · language<br>synonyms · source_record_id</code><p>中文名、多语言别名和异名可共同检索。</p></article><article><h3>来源与导入版本</h3><code>dataset · version · external_id<br>license · retrieved_at · checksum</code><p>WFO / WCVP 的标识按来源命名空间保存。</p></article><article><h3>用途与媒体资料</h3><code>use_assertions · reference_url<br>media · creator · license · source_url</code><p>用途单独举证，图片许可单独追踪。</p></article></div><p class="architecture-intro">全量接入路径：原始文件留档 → 流式规范化与校验 → 保留版本的暂存记录 → 人工确认名称映射 → 数据库索引与分页 API。分类名录本身不能替代用途资料。</p><div class="detail-actions"><a class="outline-button" href="architecture.md" download="flora-architecture.md">${icon('download')}下载结构说明</a><a class="outline-button" href="schema.sql" download="flora-schema.sql">${icon('download')}下载数据库结构</a></div><p class="source-notice">来源入口：<a href="https://list.worldfloraonline.org/" target="_blank" rel="noopener noreferrer"><u>WFO Plant List</u></a> · <a href="https://sftp.kew.org/pub/data-repositories/WCVP/" target="_blank" rel="noopener noreferrer"><u>WCVP 全量目录</u></a>。本版本尚未连接或导入这些数据源。</p></div>`)}
function safeDecode(value){try{return decodeURIComponent(value)}catch{return value}}
function route(){const hash=location.hash;if(hash.startsWith('#plant/'))openPlant(safeDecode(hash.slice(7)));else if(hash==='#credits')credits();else if(hash==='#architecture')architecture();else{if($('#detail-dialog').open)$('#detail-dialog').close();lastHash=hash||'#catalog';navigation.syncFromHash();}}
function closeDialog(){if($('#detail-dialog').open)$('#detail-dialog').close();location.hash=lastHash;currentPlant=null}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('已复制到剪贴板')}catch{toast('浏览器未允许复制，请从地址栏或详情中手动复制')}}
document.addEventListener('click',e=>{
 const b=e.target.closest('button,[data-open]');if(!b||!repo)return;
 if(b.hasAttribute('data-query')){$('#search').value=b.dataset.query;update({q:b.dataset.query},true)}
 if(b.hasAttribute('data-group')){const g=b.dataset.group;if(g)expanded.add(g);update({group:g,family:'',genus:''})}
 if(b.dataset.family){const p=repo.data.plants.find(p=>p.family.name===b.dataset.family);expanded.add(p.group);update({family:b.dataset.family,group:p.group,genus:''})}
 if(b.dataset.expand){expanded.has(b.dataset.expand)?expanded.delete(b.dataset.expand):expanded.add(b.dataset.expand);renderTree()}
 if(b.hasAttribute('data-use'))update({use:b.dataset.use});
 if(b.dataset.view)update({view:b.dataset.view,page:state.page});
 if(b.dataset.page)update({page:+b.dataset.page},true);
 if(b.dataset.clear){const key=b.dataset.clear;const patch={[key]:''};if(key==='group'){patch.family='';patch.genus=''}if(key==='family')patch.genus='';if(key==='q')$('#search').value='';update(patch)}
 if(b.dataset.open)location.hash='plant/'+b.dataset.open;
 if(b.dataset.tab){detailTab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(t=>t.setAttribute('aria-selected',String(t.dataset.tab===detailTab)));$('#detail-panel').innerHTML=tabContent(currentPlant);$('#detail-panel').setAttribute('aria-labelledby','tab-'+detailTab)}
 if(b.dataset.detailGroup||b.dataset.detailFamily||b.dataset.detailGenus){const patch={group:currentPlant.group,family:'',genus:''};if(b.dataset.detailFamily)patch.family=b.dataset.detailFamily;if(b.dataset.detailGenus){patch.family=currentPlant.family.name;patch.genus=b.dataset.detailGenus}expanded.add(patch.group);closeDialog();update(patch,true)}
 switch(b.dataset.action){
 case 'reset':reset();break;
 case 'filters':$('#filters').classList.toggle('open');b.setAttribute('aria-expanded',$('#filters').classList.contains('open'));break;
 case 'credits':location.hash='credits';break;
 case 'architecture':location.hash='architecture';break;
 case 'close':closeDialog();break;
 case 'copy-name':copy(currentPlant.scientificName+' '+currentPlant.authorship);break;
 case 'copy-link':copy(location.href);break;
 }
});
$('#search').addEventListener('input',e=>{if(!e.isComposing&&repo)update({q:e.target.value})});
$('#search').addEventListener('compositionend',e=>{if(repo)update({q:e.target.value})});
$('#search-form').addEventListener('submit',e=>{e.preventDefault();if(repo)update({q:$('#search').value},true)});
$('#genus-filter').addEventListener('change',e=>update({genus:e.target.value}));
$('#sort').addEventListener('change',e=>update({sort:e.target.value}));
$('#detail-dialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog()});
$('#detail-dialog').addEventListener('click',e=>{if(e.target===$('#detail-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog()}});
window.addEventListener('hashchange',()=>{if(repo)route()});window.addEventListener('popstate',()=>{if(repo){readURL();render();route()}});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea|select/i.test(e.target.tagName)&&!$('#detail-dialog').open){e.preventDefault();$('#search').focus();$('#hero').scrollIntoView({behavior:'smooth'})}if(e.target.matches('[data-tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')];const i=tabs.indexOf(e.target);const next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;tabs[next].click();tabs[next].focus()}});
try{
 repo=await new DemoPlantRepository().load();
 const m=repo.media['adiantum-capillus-veneris'];$('#hero-photo').src=m.path;$('#hero-credit').textContent=`© ${m.creator} · ${m.license}`;
 readURL();if(state.group)expanded.add(state.group);render();writeURL();route();
}catch(e){$('#results').innerHTML=`<div class="empty-state">${icon('info')}<h3>数据暂时无法载入</h3><p>${esc(e.message)}</p><button onclick="location.reload()">重新载入</button></div>`;$('#result-count').textContent='载入失败，请重试。';console.error(e)}
