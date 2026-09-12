import { createSectionNavigation } from './navigation.js';
import { PlantApiRepository, StaticPagedRepository } from './domain.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  sprout: 'M12 22v-9M12 16C3 16 3 7 3 7s9-1 9 9Zm0-5C12 2 21 2 21 2s1 9-9 9Z',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6', 'arrow-up-right': 'M6 18 18 6M6 6h12v12', 'chevron-right': 'm9 6 6 6-6 6',
  'chevron-left': 'm15 6-6 6 6 6', x: 'm6 6 12 12M6 18 18 6',
  grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z', list: 'M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1',
  lock: 'M6 10h12v11H6ZM8 10V6a4 4 0 0 1 8 0v4m-4 5v2', tree: 'M12 3v7M5 14v-4h14v4M2 15h6v6H2Zm14 0h6v6h-6ZM9 1h6v5H9Z',
  leaf: 'M20 3C6 1 1 9 5 16c7 5 17-1 15-13ZM4 21 15 10', flower: 'M12 12c-8 0-8-9-3-9 3 0 3 5 3 9Zm0 0c0-8 9-8 9-3 0 3-5 3-9 3Zm0 0c8 0 8 9 3 9-3 0-3-5-3-9Zm0 0c0 8-9 8-9 3 0-3 5-3 9-3Z',
  'book-open': 'M12 21c-3-3-6-3-10-3V3c4 0 7 0 10 3 3-3 6-3 10-3v15c-4 0-7 0-10 3ZM12 6v15',
  database: 'M20 5c0 2-4 3-8 3S4 7 4 5s4-3 8-3 8 1 8 3Zm0 0v14c0 2-4 3-8 3s-8-1-8-3V5m0 7c0 2 4 3 8 3s8-1 8-3',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6', info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10h.01',
  check: 'm5 12 4 4L19 6', sliders: 'M4 6h5m5 0h6M4 18h10m5 0h1M9 3v6m5 6v6', copy: 'M9 9h12v12H9ZM5 15H3V3h12v2',
};
const icon = n => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n] || paths.leaf}"/></svg>`;
const icons = (root = document) => root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const placeholderImage = 'plant-placeholder.svg';
const defaultHeroImage = 'https://pub-3517da5ed83f46628c557cd926a014a5.r2.dev/imgs/adiantum-capillus-veneris.webp';
const fallbackImage = `this.onerror=null;this.src='${placeholderImage}';this.classList.add('is-placeholder')`;

let repo, summary, currentPlant, detailTab = 'overview', listLoaded = false, listLoading = false, toastTimer, searchTimer;
let state = { q: '', lifeforms: [], family: '', sort: 'default', page: 1, pageSize: 24, view: 'grid' };
const navigation = createSectionNavigation(() => {});

function readURL() {
  const p = new URL(location.href).searchParams;
  for (const k of ['q', 'family']) state[k] = p.get(k) || '';
  state.lifeforms = (p.get('lifeform') || '').split(',').filter(Boolean);
  state.sort = ['zh', 'latin'].includes(p.get('sort')) ? p.get('sort') : 'default';
  state.view = p.get('view') === 'list' ? 'list' : 'grid';
  state.page = Math.max(1, parseInt(p.get('page') || '1', 10) || 1);
  $('#search').value = state.q;
  $('#sort').value = state.sort;
}

function writeURL() {
  const url = new URL(location.href);
  url.searchParams.delete('group');
  for (const [k, v] of Object.entries(state)) {
    if (k === 'lifeforms') {
      if (v.length) url.searchParams.set('lifeform', v.join(','));
      else url.searchParams.delete('lifeform');
      continue;
    }
    if (v && v !== 'default' && !(k === 'view' && v === 'grid') && !(k === 'page' && v === 1) && k !== 'pageSize') url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  history.replaceState(null, '', url);
}

async function loadSummary() {
  try {
    repo = new PlantApiRepository();
    summary = await repo.loadSummary();
  } catch (error) {
    const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
    if (!local) throw error;
    repo = new StaticPagedRepository();
    summary = await repo.loadSummary();
  }
}

function isUncertainZh(value) { return /[\[\]／\uE000-\uF8FF]/u.test(String(value || '')); }
function cleanZh(value) { return isUncertainZh(value) ? '' : String(value || ''); }
function lifeformName(id) { return summary.lifeforms?.find(item => item.id === id)?.name || id; }
function familyLabel(family) {
  const zh = cleanZh(family.zh);
  return `${zh || family.name || family.id}${zh && family.name && family.name !== zh ? `（${family.name}）` : ''}`;
}
function familyName(id) {
  const family = summary.families.find(f => f.id === id || f.name === id || f.zh === id);
  return family ? familyLabel(family) : id;
}
function primaryName(p) { return cleanZh(p.chineseName) || cleanZh(p.commonNames?.[0]?.name) || p.canonicalName || p.scientificName; }
function taxonZh(value, fallback) { return cleanZh(value) || fallback || ''; }
const lifeformZh = new Map([
  ['aquatic geophyte', '水生地下芽植物'], ['bulbous geophyte', '鳞茎植物'], ['rhizomatous geophyte', '根茎植物'],
  ['tuberous geophyte', '块茎植物'], ['woody geophyte', '木本地下芽植物'],
  ['succulent herb', '多肉草本'], ['succulent shrub', '多肉灌木'], ['succulent tree', '多肉乔木'],
  ['annual', '一年生草本'], ['biennial', '二年生草本'], ['perennial', '多年生草本'],
  ['herb', '草本'], ['shrub', '灌木'], ['subshrub', '亚灌木'], ['tree', '乔木'],
  ['climber', '攀援植物'], ['liana', '木质藤本'], ['epiphyte', '附生植物'],
  ['geophyte', '地下芽植物'], ['helophyte', '沼生植物'], ['hydrophyte', '水生植物'], ['aquatic', '水生植物'],
  ['parasite', '寄生植物'], ['hemiparasite', '半寄生植物'],
]);
function lifeformLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .split(/(\s+or\s+|,\s*)/i)
    .map(part => {
      if (/^\s+or\s+$/i.test(part)) return '或';
      if (/^,\s*$/.test(part)) return '、';
      return lifeformZh.get(part.trim().toLowerCase()) || part;
    })
    .join('');
}
function plantImage(p) { return p.imageUrl || p.media?.path || ''; }
function plantTags(p) { return (p.useCategories || []).map(u => `<span class="tag" data-use="${esc(u)}">${esc(u)}</span>`).join(''); }
function dataList(items, empty = '待补充。') {
  return items?.length ? `<dl>${items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || '—')}</dd>`).join('')}</dl>` : `<p>${empty}</p>`;
}

function renderHero() {
  const stats = summary.stats || { plants: 0, families: 0, groups: 3 };
  const values = [stats.plants, stats.families];
  document.querySelectorAll('.hero-stats strong').forEach((node, index) => {
    node.innerHTML = `${values[index] ?? 0}<small>${index === 0 ? '种' : '科'}</small>`;
  });
  const hero = summary.hero;
  $('#hero-photo').src = hero?.path || defaultHeroImage;
  $('#hero-photo').onerror = () => {
    $('#hero-photo').onerror = null;
    $('#hero-photo').src = placeholderImage;
    $('#hero-photo').classList.add('is-placeholder');
  };
  $('#hero-credit').textContent = hero?.creator ? `© ${hero.creator} · ${hero.license || ''}` : '';
}

function renderTree() {
  $('#taxonomy-tree').innerHTML = `<button class="tree-all ${!state.lifeforms.length ? 'is-active' : ''}" data-action="clear-lifeforms" aria-pressed="${!state.lifeforms.length}">${icon('leaf')}全部植物<span class="count">${summary.stats.plants}</span></button>` +
    (summary.lifeforms || []).map(item => `<button class="group-button ${state.lifeforms.includes(item.id) ? 'is-active' : ''}" data-lifeform="${esc(item.id)}" aria-pressed="${state.lifeforms.includes(item.id)}">${esc(item.name)}<span class="count">${item.count}</span></button>`).join('');
  $('#family-filter').innerHTML = '<option value="">全部科</option>' + summary.families.map(f => `<option value="${esc(f.id)}">${esc(familyLabel(f))}</option>`).join('');
  $('#family-filter').value = state.family;
}

function loading(message = '正在载入这一批植物') {
  $('#results').innerHTML = `<div class="empty-state">${icon('database')}<h3>${esc(message)}</h3><p>只请求当前页需要的基础信息。</p></div>`;
  $('#pagination').innerHTML = '';
}

function card(p) {
  const zh = primaryName(p);
  const subtitle = p.canonicalName || p.scientificName || '';
  return `<article class="plant-card" data-slug="${esc(p.slug)}"><div class="card-photo"><a href="#plant/${encodeURIComponent(p.slug)}" aria-label="查看${esc(zh)}详情"><img src="${esc(plantImage(p) || placeholderImage)}" alt="${esc(zh)}" loading="lazy" width="480" height="360" onerror="${fallbackImage}"></a></div><div class="card-body"><a class="card-heading" href="#plant/${encodeURIComponent(p.slug)}"><h3>${esc(zh)}</h3>${icon('arrow-up-right')}</a><p class="card-subtitle" lang="la">${esc(subtitle)}</p><p class="card-taxonomy">${esc(taxonZh(p.family?.zh, p.family?.name))}<span>/</span>${esc(taxonZh(p.genus?.zh, p.genus?.name))}</p><p class="tagline">${esc(lifeformLabel(p.lifeform) || p.tagline || p.description || '')}</p><div class="card-bottom"><div class="tags">${plantTags(p)}</div></div></div></article>`;
}

function paginationHTML(page) {
  if (!page.total) return '';
  const current = page.page || state.page;
  const pages = page.pages || Math.max(1, Math.ceil(page.total / state.pageSize));
  const shown = new Set([1, pages]);
  for (let n = current - 2; n <= current + 2; n++) if (n >= 1 && n <= pages) shown.add(n);
  let previous = 0;
  const numbers = [...shown].sort((a, b) => a - b).map(n => {
    const gap = n - previous > 1 ? '<span class="page-ellipsis">...</span>' : '';
    previous = n;
    return `${gap}<button data-page="${n}" ${current === n ? 'aria-current="page"' : ''} aria-label="第 ${n} 页">${n}</button>`;
  }).join('');
  return `<button data-page="${current - 1}" aria-label="上一页" ${current === 1 ? 'disabled' : ''}>${icon('chevron-left')}</button>${numbers}<button data-page="${current + 1}" aria-label="下一页" ${current >= pages ? 'disabled' : ''}>${icon('chevron-right')}</button><span class="page-summary">${current} / ${pages}</span>`;
}
function emptyResultsHTML() {
  const hasFilters = state.lifeforms.length || state.family;
  const action = hasFilters && state.q
    ? '<button data-action="search-without-filters">清除筛选后搜索</button>'
    : '<button data-action="reset">清除筛选，查看全部</button>';
  const hint = hasFilters
    ? '当前搜索受到生活型或科筛选影响，可以清除筛选后重试。'
    : '试试更短的名称，或调整分类筛选。';
  return `<div class="empty-state">${icon('search')}<h3>暂时没有找到这株植物</h3><p>${hint}</p>${action}</div>`;
}

async function render() {
  renderTree();
  if (!listLoaded) return loading('下滑到这里时才载入植物批次');
  listLoading = true;
  loading();
  try {
    const page = await repo.query(state);
    state.page = page.page || Math.max(1, Math.min(Math.max(1, Math.ceil(page.total / state.pageSize)), state.page));
    $('#result-count').innerHTML = `找到 <strong>${page.total}</strong> 种植物 <span> / 当前第 ${state.page} 页</span>`;
    const filters = [['q', state.q && '搜索：' + state.q], ['family', state.family && familyName(state.family)], ...state.lifeforms.map(id => [`lifeform:${id}`, lifeformName(id)])];
    $('#active-filters').innerHTML = filters.filter(([, v]) => v).map(([k, v]) => `<button class="active-chip" data-clear="${k}" aria-label="移除${esc(v)}筛选">${esc(v)}${icon('x')}</button>`).join('');
    $('#results').className = `plant-grid ${state.view === 'list' ? 'list-view' : ''}`;
    $('#results').innerHTML = page.items.length ? page.items.map(card).join('') : emptyResultsHTML();
    $('#pagination').innerHTML = paginationHTML(page);
    document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(state.view === b.dataset.view)));
    $('#sort').value = state.sort;
  } catch (e) {
    $('#results').innerHTML = `<div class="empty-state">${icon('info')}<h3>植物批次载入失败</h3><p>${esc(e.message)}</p><button data-action="retry-list">重新载入</button></div>`;
  } finally {
    listLoading = false;
  }
}

async function update(patch, scroll = false) {
  Object.assign(state, { page: 1 }, patch);
  writeURL();
  await render();
  if (scroll) navigation.go('explore');
}
function queueSearch(value) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => update({ q: value }), 300);
}

function toolbar(text) {
  return `<div class="dialog-toolbar"><div class="breadcrumbs">草木集 ${icon('chevron-right')} ${text}</div><button class="close-dialog" data-action="close" aria-label="关闭详情">${icon('x')}</button></div>`;
}
function showDialog(content) {
  $('#dialog-content').innerHTML = content;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-dialog').scrollTop = 0;
}

function tabContent(p) {
  if (detailTab === 'overview') return `<div class="detail-tree"><span>植物界</span>${icon('chevron-right')}<button data-detail-family="${esc(p.family?.id || '')}">${esc(taxonZh(p.family?.zh, p.family?.name))}</button>${icon('chevron-right')}<span>${esc(taxonZh(p.genus?.zh, p.genus?.name))}</span></div><div class="detail-info-grid"><div><h3>分类层级</h3><p>${esc(p.family?.name || '')} · ${esc(p.genus?.name || '')}<br>${esc(p.rank || 'species')}</p></div><div><h3>主表 ID</h3>${dataList([['WCVP', p.wcvpId], ['WFO', p.wfoId], ['GBIF', p.gbifId], ['NCBI', p.ncbiTaxid], ['IPNI', p.ipniId], ['POWO', p.powoId]])}</div><div><h3>生活型</h3><p>${esc(lifeformLabel(p.lifeform) || p.lifeform || '待补充。')}</p></div><div><h3>分布</h3><p>${esc(p.geographicArea || '待补充。')}</p></div></div>`;
  if (detailTab === 'uses') return `<div class="detail-info-grid"><div><h3>Trait Assertions</h3>${dataList((p.traits || []).map(t => [t.trait_name, t.raw_value || t.trait_value]))}</div><div><h3>异名</h3>${(p.synonyms || []).length ? `<ul>${p.synonyms.map(s => `<li><span lang="la">${esc(s.synonym_name)}</span></li>`).join('')}</ul>` : '<p>暂无异名。</p>'}</div></div>`;
  if (detailTab === 'provenance') return `<div class="detail-info-grid"><div><h3>外部 ID</h3>${dataList((p.externalIds || []).map(i => [i.source_db, `${i.external_id} · ${i.match_type}`]))}</div><div><h3>数据来源</h3><p>分类主干来自 WCVP；WFO 通过官方 IPNI→WFO lookup 补充；GBIF 与 NCBI 使用精确匹配映射。</p></div></div>`;
  return '';
}

function detailContent(p) {
  const zh = primaryName(p);
  return `${toolbar(`${esc(taxonZh(p.family?.zh, p.family?.name))} ${icon('chevron-right')} ${esc(zh)}`)}<div class="detail-top"><div><img class="detail-image" src="${esc(plantImage(p) || placeholderImage)}" alt="${esc(zh)}" onerror="${fallbackImage}"></div><div class="detail-intro"><p class="eyebrow">PLANT PORTRAIT</p><h2 id="dialog-title">${esc(zh)}</h2><p class="detail-scientific" lang="la">${esc(p.scientificName)}<small>${esc(p.authorship || '')}</small></p><div class="tags">${plantTags(p)}</div><p class="description">${esc(p.description || p.tagline || '这条记录的详细资料还在整理中。')}</p><div class="detail-actions"><button data-action="copy-name">${icon('copy')}复制学名</button><button data-action="copy-link">${icon('arrow-up-right')}复制详情链接</button></div></div></div><div class="detail-tabs" role="tablist" aria-label="植物资料"><button role="tab" id="tab-overview" data-tab="overview" aria-controls="detail-panel" aria-selected="${detailTab === 'overview'}">植物档案</button><button role="tab" id="tab-uses" data-tab="uses" aria-controls="detail-panel" aria-selected="${detailTab === 'uses'}">用途与特点</button><button role="tab" id="tab-provenance" data-tab="provenance" aria-controls="detail-panel" aria-selected="${detailTab === 'provenance'}">来源与许可</button></div><div class="tab-content" role="tabpanel" id="detail-panel" aria-labelledby="tab-${detailTab}">${tabContent(p)}</div>`;
}

function credits() {
  showDialog(`${toolbar('图片来源与许可')}<div class="tab-content"><h2 class="credits-title" id="dialog-title">图片按需从 R2 载入。</h2><p class="architecture-intro">列表和详情只保存图片地址。对象存储前缀为 <code>/imgs</code>，文件名按小写物种学名把空格替换为中划线生成。</p></div>`);
}

function architecture() {
  showDialog(`${toolbar('数据结构')}<div class="tab-content"><h2 class="credits-title" id="dialog-title">三层加载，减少数据库压力。</h2><div class="schema-list"><article><h3>第一层</h3><code>/api/summary</code><p>统计物种数、科数和 3 个固定类群，并一次性取回科名录。</p></article><article><h3>第二层</h3><code>/api/plants</code><p>进入图鉴区后分页查询 taxa，返回总数、分页信息、卡片基础字段和上级科属。</p></article><article><h3>第三层</h3><code>/api/plants/:taxon_id</code><p>用户点开某株植物时再请求详情。</p></article><article><h3>图片</h3><code>R2 / imgs</code><p>图片由浏览器直接访问 R2，不经过数据库传输文件内容。</p></article></div></div>`);
}

async function openPlant(slug) {
  showDialog(`${toolbar('载入中')}<div class="tab-content"><h2 id="dialog-title" class="credits-title">正在载入植物详情</h2></div>`);
  try {
    currentPlant = await repo.get(slug);
    detailTab = 'overview';
    showDialog(detailContent(currentPlant));
  } catch {
    showDialog(`${toolbar('未找到')}<div class="tab-content"><h2 id="dialog-title" class="credits-title">这条植物记录尚未收录</h2><button class="outline-button" data-action="close">返回图鉴</button></div>`);
  }
}

function closeDialog() {
  if ($('#detail-dialog').open) $('#detail-dialog').close();
  currentPlant = null;
  if (location.hash.startsWith('#plant/')) history.replaceState(null, '', location.pathname + location.search + '#catalog');
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2600);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板'); } catch { toast('浏览器未允许复制，请手动复制'); }
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button,[data-open]');
  if (!b || !repo) return;
  if (b.hasAttribute('data-query')) { $('#search').value = b.dataset.query; await update({ q: b.dataset.query }, true); }
  if (b.dataset.lifeform) {
    const lifeforms = state.lifeforms.includes(b.dataset.lifeform) ? state.lifeforms.filter(id => id !== b.dataset.lifeform) : [...state.lifeforms, b.dataset.lifeform];
    await update({ lifeforms });
  }
  if (b.dataset.family) await update({ family: b.dataset.family });
  if (b.dataset.view) await update({ view: b.dataset.view, page: state.page });
  if (b.dataset.page) { state.page = Number(b.dataset.page); writeURL(); await render(); navigation.go('explore'); }
  if (b.dataset.clear) {
    if (b.dataset.clear.startsWith('lifeform:')) await update({ lifeforms: state.lifeforms.filter(id => id !== b.dataset.clear.slice(9)) });
    else { const patch = { [b.dataset.clear]: '' }; if (b.dataset.clear === 'q') $('#search').value = ''; await update(patch); }
  }
  if (b.dataset.open) location.hash = 'plant/' + encodeURIComponent(b.dataset.open);
  if (b.dataset.detailFamily) { closeDialog(); await update({ family: b.dataset.detailFamily || '' }, true); }
  if (b.dataset.tab && currentPlant) { detailTab = b.dataset.tab; document.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === detailTab))); $('#detail-panel').innerHTML = tabContent(currentPlant); $('#detail-panel').setAttribute('aria-labelledby', 'tab-' + detailTab); }
  switch (b.dataset.action) {
    case 'reset': $('#search').value = ''; await update({ q: '', lifeforms: [], family: '' }); break;
    case 'search-without-filters': await update({ lifeforms: [], family: '' }, true); break;
    case 'clear-lifeforms': await update({ lifeforms: [] }); break;
    case 'filters': $('#filters').classList.toggle('open'); b.setAttribute('aria-expanded', $('#filters').classList.contains('open')); break;
    case 'retry-list': listLoaded = true; await render(); break;
    case 'credits': location.hash = 'credits'; break;
    case 'architecture': location.hash = 'architecture'; break;
    case 'close': closeDialog(); break;
    case 'copy-name': copy(`${currentPlant.scientificName} ${currentPlant.authorship || ''}`.trim()); break;
    case 'copy-link': copy(location.href); break;
  }
});

$('#search').addEventListener('input', e => { if (!e.isComposing && repo) queueSearch(e.target.value); });
$('#search').addEventListener('compositionend', e => { if (repo) queueSearch(e.target.value); });
$('#search-form').addEventListener('submit', e => { e.preventDefault(); clearTimeout(searchTimer); update({ q: $('#search').value }, true); });
$('#family-filter').addEventListener('change', e => update({ family: e.target.value }));
$('#sort').addEventListener('change', e => update({ sort: e.target.value }));
$('#detail-dialog').addEventListener('cancel', e => { e.preventDefault(); closeDialog(); });
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#plant/')) openPlant(decodeURIComponent(location.hash.slice(7)));
  else if (location.hash === '#credits') credits();
  else if (location.hash === '#architecture') architecture();
  else if ($('#detail-dialog').open) closeDialog();
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName) && !$('#detail-dialog').open) { e.preventDefault(); $('#search').focus(); $('#hero').scrollIntoView({ behavior: 'smooth' }); }
});

try {
  icons();
  await loadSummary();
  renderHero();
  readURL();
  await render();
  new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && !listLoaded && !listLoading) {
      listLoaded = true;
      render();
    }
  }, { rootMargin: '240px' }).observe($('#catalog'));
  if (location.hash.startsWith('#plant/')) openPlant(decodeURIComponent(location.hash.slice(7)));
  if (location.hash === '#credits') credits();
  if (location.hash === '#architecture') architecture();
} catch (e) {
  $('#results').innerHTML = `<div class="empty-state">${icon('info')}<h3>数据暂时无法载入</h3><p>${esc(e.message)}</p><button onclick="location.reload()">重新载入</button></div>`;
  $('#result-count').textContent = '载入失败，请重试。';
  console.error(e);
}
