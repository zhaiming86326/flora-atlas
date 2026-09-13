// Local, read-only preview. No D1 writes and no article-content downloads.
const WD_API = 'https://www.wikidata.org/w/api.php';
const SPECIES = 'Q7432';
const GENUS = 'Q34740';
const FAMILY = 'Q35409';
const norm = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const unique = values => [...new Set(values)];
const isQid = value => /^Q[1-9]\d*$/.test(value);

class PreviewError extends Error {
  constructor(code, message, status = 502, retryAfter = null) {
    super(message);
    Object.assign(this, { code, status, retryAfter });
  }
}

function response(body, status = 200, retryAfter = null) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (retryAfter !== null) headers['retry-after'] = String(retryAfter);
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}

// Prefer preferred statements; ignore deprecated and unknown-value statements.
function values(entity, property) {
  const statements = (entity?.claims?.[property] ?? []).filter(s =>
    s.rank !== 'deprecated' && s.mainsnak?.snaktype === 'value');
  const preferred = statements.filter(s => s.rank === 'preferred');
  return (preferred.length ? preferred : statements).map(s => s.mainsnak.datavalue?.value).filter(v => v != null);
}
const names = entity => values(entity, 'P225').filter(v => typeof v === 'string');
const ids = (entity, property) => unique(values(entity, property).map(v => v.id).filter(isQid));

function assess(entity, target, entities, synonyms) {
  const candidateNames = names(entity);
  const ranks = ids(entity, 'P105');
  const acceptedNameMatch = candidateNames.some(n => norm(n) === norm(target.lookup_name));
  const synonymMatch = candidateNames.some(n => synonyms.some(s => norm(s) === norm(n)));
  const rankMatch = norm(target.taxon_rank) === 'species'
    ? (ranks.length === 1 && ranks[0] === SPECIES) : null;
  const ancestry = [];
  const seen = new Set([entity.id]);
  let pending = ids(entity, 'P171');
  let ancestryIncomplete = false;
  while (pending.length) {
    const qid = pending.shift();
    if (seen.has(qid)) { ancestryIncomplete = true; continue; }
    seen.add(qid);
    const parent = entities[qid];
    if (!parent || parent.missing !== undefined) { ancestryIncomplete = true; continue; }
    ancestry.push({ qid, names: names(parent), ranks: ids(parent, 'P105') });
    // A family is sufficient for this local identity preview.
    if (!ids(parent, 'P105').includes(FAMILY)) pending.push(...ids(parent, 'P171'));
  }
  function compareAncestor(rank, expected) {
    const found = ancestry.filter(a => a.ranks.includes(rank)).flatMap(a => a.names);
    if (!norm(expected) || !found.length) return null;
    return found.every(name => norm(name) === norm(expected));
  }
  const genusMatch = compareAncestor(GENUS, target.genus);
  const familyMatch = compareAncestor(FAMILY, target.family);
  const reasons = [];
  if (!acceptedNameMatch) reasons.push(synonymMatch ? '通过异名匹配，需要核对分类范围' : 'P225 学名与目标接受名不一致');
  if (rankMatch !== true) reasons.push(rankMatch === null ? '本阶段仅自动核对 species 等级' : '分类等级不是唯一的 species');
  if (genusMatch !== true) reasons.push(genusMatch === null ? '缺少属级证据' : '属名存在冲突');
  if (familyMatch !== true) reasons.push(familyMatch === null ? '缺少科级证据' : '科名存在冲突');
  if (ancestryIncomplete) reasons.push('上级分类链不完整或存在重复路径，需人工检查');
  return {
    qid: entity.id,
    wikidataUrl: `https://www.wikidata.org/wiki/${entity.id}`,
    label: entity.labels?.zh?.value || entity.labels?.en?.value || '',
    description: entity.descriptions?.zh?.value || entity.descriptions?.en?.value || '',
    assessment: reasons.length === 0 ? 'strong_candidate' : 'needs_review',
    reasons,
    evidence: { taxonNames: candidateNames, rankIds: ranks, acceptedNameMatch, synonymMatch,
      rankMatch, genusMatch, familyMatch, ancestry, ancestryIncomplete,
      authorshipChecked: false, localAuthorship: target.authorship || '' },
    wikipedia: [],
  };
}

async function readJsonLimited(res) {
  if (!res.body) throw new PreviewError('EMPTY_RESPONSE', 'Wikimedia 返回空响应。');
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new PreviewError('RESPONSE_TOO_LARGE', '上游响应超过本地预览的 2 MiB 限制。');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new PreviewError('INVALID_UPSTREAM_JSON', '上游未返回有效 JSON，请检查本机网络或代理。'); }
}

export function createWikiPreviewHandler({ fetchImpl = fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  // Single local isolate only; this is not a distributed/cloud rate limiter.
  let busy = false;
  let nextRequestAt = 0;
  let blockedUntil = 0;

  return async function handle(request, env) {
    const url = new URL(request.url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (String(env.WIKI_PREVIEW_ENABLED) !== 'true' || !local) {
      return response({ error: '本地匹配预览未启用。', code: 'PREVIEW_DISABLED' }, 404);
    }
    let bridgeUrl = null;
    if (env.WIKI_PROXY_URL) {
      try {
        bridgeUrl = new URL(String(env.WIKI_PROXY_URL));
        if (bridgeUrl.protocol !== 'http:' || bridgeUrl.hostname !== '127.0.0.1'
          || bridgeUrl.username || bridgeUrl.password || bridgeUrl.pathname !== '/'
          || bridgeUrl.search || bridgeUrl.hash) throw new Error('invalid bridge');
      } catch {
        return response({ error: 'WIKI_PROXY_URL 应为本地转发服务地址，例如 http://127.0.0.1:8790，不能填 10809 代理端口。',
          code: 'INVALID_BRIDGE_URL' }, 503);
      }
    }
    if (request.method !== 'GET') return response({ error: '请使用 GET。', code: 'METHOD_NOT_ALLOWED' }, 405);
    if (!env.DB) return response({ error: '缺少主库绑定 DB。', code: 'DB_NOT_CONFIGURED' }, 503);
    const contact = String(env.WIKIMEDIA_CONTACT || '').trim();
    if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(contact)
      || /YOUR_|example\.(com|org)|[\r\n]/i.test(contact)) {
      return response({ error: '请在 wrangler.preview.jsonc 的 WIKIMEDIA_CONTACT 填写真实联系邮箱（mailto:...）或项目 HTTPS 地址。',
        code: 'CONTACT_REQUIRED' }, 503);
    }
    if (blockedUntil > now()) return response({ error: '上游要求等待，请稍后重试。', code: 'UPSTREAM_COOLDOWN' },
      429, Math.ceil((blockedUntil - now()) / 1000));
    if (busy) return response({ error: '已有一条预览正在执行，请等待完成。', code: 'PREVIEW_BUSY' }, 429, 5);
    busy = true;
    let requestCount = 0;
    try {
      const targetId = url.searchParams.get('taxon_id');
      if (targetId !== null && !/^wcvp:\d{1,30}$/.test(targetId)) {
        throw new PreviewError('INVALID_TAXON_ID', 'taxon_id 格式应为 wcvp:100023。', 400);
      }
      const target = await env.DB.prepare(`SELECT e.taxon_id, e.lookup_name, e.status,
        b.scientific_name, b.authorship, b.taxon_rank, b.family, b.genus,
        b.normalized_accepted_taxon_id, b.is_accepted
        FROM plant_enrichment_targets e JOIN taxonomic_backbone b ON b.taxon_id = e.taxon_id
        WHERE ${targetId === null ? "e.status = 'pending'" : 'e.taxon_id = ?'}
        ORDER BY e.taxon_id LIMIT 1`).bind(...(targetId === null ? [] : [targetId])).first();
      if (!target) return response({ code: 'TARGET_NOT_FOUND', error: '没有找到目标；请确认本地样本已导入。' }, 404);
      if (target.is_accepted !== 1 || target.normalized_accepted_taxon_id !== target.taxon_id) {
        throw new PreviewError('INVALID_TARGET', '目标不是规范化接受名，请先检查本地分类关系。', 409);
      }
      const chinese = await env.DB.prepare(`SELECT c.chinese_name, c.taxon_id
        FROM chinese_taxon_names c JOIN taxonomic_backbone b ON b.taxon_id = c.taxon_id
        WHERE b.normalized_accepted_taxon_id = ? ORDER BY c.taxon_id LIMIT 30`).bind(target.taxon_id).all();
      const synonymRows = await env.DB.prepare(`SELECT canonical_name, scientific_name
        FROM taxonomic_backbone WHERE normalized_accepted_taxon_id = ? AND taxon_id <> ?
        ORDER BY taxon_id LIMIT 20`).bind(target.taxon_id, target.taxon_id).all();
      const synonyms = unique((synonymRows.results || []).map(r => r.canonical_name || r.scientific_name).filter(Boolean));

      async function api(base, params) {
        if (requestCount >= 16) throw new PreviewError('REQUEST_BUDGET', '本次预览已达到请求数量上限。');
        await sleep(Math.max(0, nextRequestAt - now()));
        nextRequestAt = now() + 1100;
        const endpoint = new URL(base);
        endpoint.search = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), bridgeUrl ? 30000 : 20000);
        requestCount += 1;
        try {
          const destination = bridgeUrl ? new URL('/wiki', bridgeUrl) : endpoint;
          if (bridgeUrl) destination.searchParams.set('url', endpoint.toString());
          const res = await fetchImpl(destination.toString(), {
            headers: { 'User-Agent': `FloraAtlasPreview/0.1 (${contact})`, Accept: 'application/json',
              ...(bridgeUrl ? { 'X-Wiki-Preview': '1' } : {}) },
            signal: controller.signal,
          });
          if (bridgeUrl && res.headers.get('x-wiki-bridge-error')) {
            const detail = await readJsonLimited(res);
            throw new PreviewError('LOCAL_BRIDGE_ERROR', String(detail.error || '本地转发失败，请查看 Python 终端。'));
          }
          if (res.status === 429 || res.status === 503) {
            const retry = res.headers.get('retry-after');
            const seconds = retry && /^\d+$/.test(retry) ? Number(retry)
              : retry && Number.isFinite(Date.parse(retry)) ? Math.ceil((Date.parse(retry) - now()) / 1000) : 60;
            const wait = Math.max(5, seconds);
            blockedUntil = now() + wait * 1000;
            await res.body?.cancel();
            throw new PreviewError('UPSTREAM_RATE_LIMIT', 'Wikimedia 暂时限流或繁忙，请按 Retry-After 等待。', 429, wait);
          }
          if (!res.ok) {
            await res.body?.cancel();
            throw new PreviewError('UPSTREAM_HTTP_ERROR', `Wikimedia 返回 HTTP ${res.status}，不能据此判断植物无条目。`);
          }
          const data = await readJsonLimited(res);
          if (data.error) {
            if (['maxlag', 'ratelimited'].includes(data.error.code)) {
              blockedUntil = now() + 60000;
              throw new PreviewError('UPSTREAM_RATE_LIMIT', 'Wikimedia API 要求稍后重试。', 429, 60);
            }
            throw new PreviewError('UPSTREAM_API_ERROR', `Wikimedia API 错误：${String(data.error.code || 'unknown').slice(0, 80)}`);
          }
          return data;
        } catch (err) {
          if (err instanceof PreviewError) throw err;
          throw new PreviewError(bridgeUrl ? 'LOCAL_BRIDGE_UNREACHABLE'
            : controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK_ERROR',
          bridgeUrl ? '无法连接本地转发程序或等待超时。请确认 Python 转发服务仍运行，并访问 http://127.0.0.1:8790/health 检查。'
            : '访问 Wikimedia 失败或超时，请检查运行 Wrangler 的电脑是否能访问 Wikidata 和维基百科。');
        } finally { clearTimeout(timer); }
      }

      const search = await api(WD_API, { action: 'wbsearchentities', search: target.lookup_name,
        language: 'en', uselang: 'zh', type: 'item', limit: '5' });
      if (!Array.isArray(search.search)) throw new PreviewError('INVALID_SEARCH_RESPONSE', '上游搜索响应缺少 search 数组。');
      const candidateIds = unique(search.search.map(r => r.id).filter(isQid));
      const entities = {};
      async function getEntities(qids) {
        if (!qids.length) return;
        const data = await api(WD_API, { action: 'wbgetentities', ids: qids.join('|'),
          props: 'labels|descriptions|claims|sitelinks', languages: 'zh|en', sitefilter: 'zhwiki|enwiki' });
        if (!data.entities || typeof data.entities !== 'object') throw new PreviewError('INVALID_ENTITY_RESPONSE', '上游响应缺少 entities。');
        Object.assign(entities, data.entities);
      }
      await getEntities(candidateIds);
      // Bounded ancestor traversal: 5 layers, at most 30 new entities per layer.
      let frontier = candidateIds;
      for (let depth = 0; depth < 5; depth += 1) {
        const parents = unique(frontier.flatMap(qid => ids(entities[qid], 'P105').includes(FAMILY)
          ? [] : ids(entities[qid], 'P171'))).filter(qid => !entities[qid]).slice(0, 30);
        if (!parents.length) break;
        await getEntities(parents);
        frontier = parents;
      }
      const candidates = candidateIds.filter(qid => entities[qid] && entities[qid].missing === undefined)
        .map(qid => assess(entities[qid], target, entities, synonyms));
      // Safe cloud import only needs the verified Chinese Wikipedia page.
      for (const language of ['zh']) {
        const linked = candidates.map(candidate => ({ candidate,
          title: entities[candidate.qid].sitelinks?.[`${language}wiki`]?.title })).filter(r => r.title);
        if (!linked.length) continue;
        const pageData = await api(`https://${language}.wikipedia.org/w/api.php`, {
          action: 'query', titles: unique(linked.map(r => r.title)).join('|'), redirects: '1',
          prop: 'pageprops|info', ppprop: 'wikibase_item|disambiguation', inprop: 'url',
        });
        if (!Array.isArray(pageData.query?.pages)) throw new PreviewError('INVALID_PAGE_RESPONSE', '上游响应缺少 pages 数组。');
        const transitions = new Map([...(pageData.query.normalized || []), ...(pageData.query.converted || []),
          ...(pageData.query.redirects || [])].map(r => [r.from, r.to]));
        for (const { candidate, title } of linked) {
          let finalTitle = title;
          const visited = new Set();
          while (transitions.has(finalTitle) && !visited.has(finalTitle)) {
            visited.add(finalTitle); finalTitle = transitions.get(finalTitle);
          }
          const page = pageData.query.pages.find(p => p.title === finalTitle);
          const exists = Boolean(page && page.missing === undefined && page.invalid === undefined && page.ns === 0);
          const disambiguation = Boolean(page && Object.hasOwn(page.pageprops || {}, 'disambiguation'));
          const qidMatches = page?.pageprops?.wikibase_item === candidate.qid;
          candidate.wikipedia.push({ language, requestedTitle: title, title: page?.title || finalTitle,
            pageId: page?.pageid ?? null, revisionId: page?.lastrevid ?? null,
            url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page?.title || finalTitle)}`,
            exists, disambiguation, qidMatches, verified: exists && !disambiguation && qidMatches });
        }
      }
      const strong = candidates.filter(c => c.assessment === 'strong_candidate');
      return response({ mode: 'preview', writesPerformed: false, target: { ...target,
        chineseNames: chinese.results || [], synonyms },
        result: candidates.length === 0 ? 'no_candidates_found' : strong.length === 1 ? 'candidate_for_review' : 'needs_review',
        requiresManualReview: true, candidates, networkRequests: requestCount,
        transport: bridgeUrl ? 'local-curl-proxy' : 'direct',
        notes: ['只检索接受学名的前 5 个 Wikidata 候选；未命中不代表不存在。',
          '异名只作证据展示，本阶段未逐一搜索异名。',
          '命名人、分类范围及全部权威外部编号尚未核验，strong_candidate 也不是最终确认。',
          '未下载正文、未写入数据库，重复预览不会改变 pending 状态。'] });
    } catch (err) {
      if (err instanceof PreviewError) return response({ error: err.message, code: err.code,
        writesPerformed: false, networkRequests: requestCount }, err.status, err.retryAfter);
      console.error('Wiki preview local database/processing error:', err);
      return response({ error: '本地查询或处理失败，请检查终端日志及三张样本表。', code: 'LOCAL_PREVIEW_ERROR',
        writesPerformed: false }, 500);
    } finally { busy = false; }
  };
}

export const handleWikiPreview = createWikiPreviewHandler();
