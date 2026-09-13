import { handleWikiPreview } from './wiki-preview.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

class ImportError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    Object.assign(this, { code, status });
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  } });
}

function bridgeUrlFromEnv(env) {
  if (!env.WIKI_PROXY_URL) return null;
  try {
    const url = new URL(String(env.WIKI_PROXY_URL));
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid');
    return url;
  } catch {
    throw new ImportError('INVALID_BRIDGE_URL',
      'WIKI_PROXY_URL 应为本地转发服务地址，例如 http://127.0.0.1:8790。', 503);
  }
}

async function readJsonLimited(response) {
  if (!response.body) throw new ImportError('EMPTY_RESPONSE', 'Wikimedia 返回空响应。');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ImportError('RESPONSE_TOO_LARGE', '条目源码超过 2 MiB，未写入数据库。', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ImportError('INVALID_UPSTREAM_JSON', 'Wikimedia 未返回有效 JSON。'); }
}

function parseWikitext(value) {
  if (typeof value === 'string') return value;
  if (typeof value?.['*'] === 'string') return value['*'];
  throw new ImportError('INVALID_PARSE_RESPONSE', '固定版本响应缺少 wikitext。');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function stripBalancedTemplates(text) {
  let output = '';
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === '{{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (pair === '}}' && depth) {
      depth -= 1;
      index += 1;
      continue;
    }
    if (!depth) output += text[index];
  }
  return output;
}

function cleanWikitext(text) {
  return stripBalancedTemplates(String(text || ''))
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref\b[^/>]*\/>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\[(?:File|Image|文件|圖像|图像):[^\]]+\]\]/gi, '')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*[\*#:;]+/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sectionMap(wikitext) {
  const sections = new Map();
  let current = 'lead';
  let buffer = [];
  function flush() {
    sections.set(current, (sections.get(current) || '') + buffer.join('\n'));
    buffer = [];
  }
  for (const line of String(wikitext || '').split(/\r?\n/)) {
    const match = line.match(/^\s*={2,6}\s*(.*?)\s*={2,6}\s*$/);
    if (match) {
      flush();
      current = match[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function findSection(sections, patterns) {
  for (const [title, body] of sections) {
    if (title === 'lead') continue;
    if (patterns.some(pattern => pattern.test(title))) return cleanWikitext(body);
  }
  return '';
}

function extractArticleFields(wikitext) {
  const sections = sectionMap(wikitext);
  const lead = cleanWikitext(sections.get('lead') || '').replace(/^\s*\|.*$/gm, '').trim();
  const conservationFromSection = findSection(sections, [/保护状况/, /保育狀況/, /保护/, /保育/]);
  const conservationFromTemplate = Array.from(String(wikitext || '').matchAll(/\|\s*(?:status|保护状况|保護狀況)\s*=\s*([^\n|}]+)/gi))
    .map(match => cleanWikitext(match[1])).filter(Boolean).join('\n');
  return {
    lead_text: lead,
    morphology_text: findSection(sections, [/形态/, /形態/, /特征/, /特徵/, /描述/]),
    uses_text: findSection(sections, [/用途/, /利用/, /食用/, /药用/, /藥用/]),
    cultivation_text: findSection(sections, [/栽培/, /种植/, /種植/]),
    propagation_text: findSection(sections, [/繁殖/]),
    varieties_text: findSection(sections, [/变种/, /變種/, /品种/, /品種/, /亚种/, /亞種/]),
    nutrition_text: findSection(sections, [/每\s*100\s*g/i, /营养/, /營養/, /食物营养值/, /食物營養值/]),
    conservation_status_text: conservationFromSection || conservationFromTemplate,
  };
}

export function createWikiImportHandler({ previewHandler = handleWikiPreview, fetchImpl = fetch,
  now = () => new Date() } = {}) {
  let busy = false;

  return async function handle(request, env) {
    const requestUrl = new URL(request.url);
    if (String(env.WIKI_IMPORT_ENABLED) !== 'true' || !LOCAL_HOSTS.has(requestUrl.hostname)) {
      return json({ error: '本地单条导入未启用。', code: 'IMPORT_DISABLED', writesPerformed: false }, 404);
    }
    if (request.method !== 'POST') {
      return json({ error: '请使用 POST。', code: 'METHOD_NOT_ALLOWED', writesPerformed: false }, 405);
    }
    if (request.headers.get('X-Flora-Confirm') !== 'import-one') {
      return json({ error: '缺少确认头 X-Flora-Confirm: import-one。', code: 'CONFIRMATION_REQUIRED',
        writesPerformed: false }, 403);
    }
    const skipMainStatusUpdate = String(env.WIKI_IMPORT_SKIP_MAIN_STATUS_UPDATE || '').toLowerCase() === 'true';
    if ((!env.DB && !skipMainStatusUpdate) || !env.CONTENT_DB) {
      return json({ error: '需要 CONTENT_DB；除非显式跳过主库状态更新，否则还需要 DB。', code: 'DB_NOT_CONFIGURED',
        writesPerformed: false }, 503);
    }
    const taxonId = requestUrl.searchParams.get('taxon_id');
    if (!/^wcvp:\d{1,30}$/.test(taxonId || '')) {
      return json({ error: '必须提供 taxon_id，例如 wcvp:100023。', code: 'INVALID_TAXON_ID',
        writesPerformed: false }, 400);
    }
    if (busy) return json({ error: '已有一条导入正在执行。', code: 'IMPORT_BUSY', writesPerformed: false }, 429);
    busy = true;
    let contentWritten = false;
    try {
      const previewUrl = new URL('/api/enrichment/preview', requestUrl);
      previewUrl.searchParams.set('taxon_id', taxonId);
      const previewResponse = await previewHandler(new Request(previewUrl, { method: 'GET' }), env);
      const preview = await previewResponse.json();
      if (!previewResponse.ok) {
        return json({ ...preview, importStage: 'identity_preview', writesPerformed: false }, previewResponse.status);
      }
      const strong = (preview.candidates || []).filter(candidate => candidate.assessment === 'strong_candidate');
      if (preview.result !== 'candidate_for_review' || strong.length !== 1) {
        throw new ImportError('MATCH_NOT_UNIQUE', '没有唯一 strong_candidate，拒绝下载和写入。', 409);
      }
      const candidate = strong[0];
      const pages = (candidate.wikipedia || []).filter(page => page.language === 'zh' && page.verified);
      if (pages.length !== 1 || !Number.isSafeInteger(pages[0].pageId)
        || !Number.isSafeInteger(pages[0].revisionId)) {
        throw new ImportError('ZH_PAGE_NOT_VERIFIED', '没有唯一且已验证的中文维基页面及版本号。', 409);
      }
      const page = pages[0];
      const endpoint = new URL('https://zh.wikipedia.org/w/api.php');
      endpoint.search = new URLSearchParams({
        action: 'parse', oldid: String(page.revisionId), prop: 'wikitext|tocdata|revid|displaytitle',
        format: 'json', formatversion: '2', maxlag: '5',
      });
      const bridge = bridgeUrlFromEnv(env);
      const destination = bridge ? new URL('/wiki', bridge) : endpoint;
      if (bridge) destination.searchParams.set('url', endpoint.toString());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), bridge ? 30000 : 20000);
      let upstream;
      try {
        upstream = await fetchImpl(destination.toString(), { signal: controller.signal, headers: {
          'User-Agent': `FloraAtlasPreview/0.1 (${String(env.WIKIMEDIA_CONTACT || '').trim()})`,
          Accept: 'application/json', ...(bridge ? { 'X-Wiki-Preview': '1' } : {}),
        } });
      } catch {
        throw new ImportError(bridge ? 'LOCAL_BRIDGE_UNREACHABLE' : 'UPSTREAM_NETWORK_ERROR',
          bridge ? '无法连接本地转发程序或等待超时。' : '访问中文维基失败或超时。');
      } finally {
        clearTimeout(timer);
      }
      if (bridge && upstream.headers.get('x-wiki-bridge-error')) {
        const detail = await readJsonLimited(upstream);
        throw new ImportError('LOCAL_BRIDGE_ERROR', String(detail.error || '本地转发失败。'));
      }
      if (!upstream.ok) {
        await upstream.body?.cancel();
        throw new ImportError('UPSTREAM_HTTP_ERROR', `中文维基返回 HTTP ${upstream.status}。`,
          upstream.status === 429 ? 429 : 502);
      }
      const parsed = await readJsonLimited(upstream);
      if (parsed.error) throw new ImportError('UPSTREAM_API_ERROR',
        `中文维基 API 错误：${String(parsed.error.code || 'unknown').slice(0, 80)}`);
      const result = parsed.parse;
      if (!result || result.pageid !== page.pageId || result.revid !== page.revisionId) {
        throw new ImportError('REVISION_MISMATCH', '返回页面或版本与预览锁定值不一致，未写入。', 409);
      }
      const wikitext = parseWikitext(result.wikitext);
      if (!wikitext.trim()) throw new ImportError('EMPTY_WIKITEXT', '固定版本正文为空，未写入。', 409);
      const fetchedAt = now().toISOString();
      const documentId = `wikipedia:zh:${page.pageId}`;
      const permanentUrl = `https://zh.wikipedia.org/w/index.php?oldid=${page.revisionId}`;
      const evidence = JSON.stringify({
        qid: candidate.qid,
        assessment: candidate.assessment,
        evidence: candidate.evidence,
        wikipedia: page,
        previewResult: preview.result,
      });
      const digest = await sha256(wikitext);
      const extracted = extractArticleFields(wikitext);
      const statements = [
        env.CONTENT_DB.prepare(`INSERT INTO source_documents
          (document_id, source, language, external_page_id, wikidata_qid, title, canonical_url,
           license_name, license_url, latest_revision_id, match_status, imported_at, updated_at)
          VALUES (?, 'wikipedia', 'zh', ?, ?, ?, ?, 'CC BY-SA 4.0',
            'https://creativecommons.org/licenses/by-sa/4.0/', ?, 'matched_unreviewed', ?, ?)
          ON CONFLICT(document_id) DO UPDATE SET
            wikidata_qid=excluded.wikidata_qid, title=excluded.title,
            canonical_url=excluded.canonical_url, latest_revision_id=excluded.latest_revision_id,
            updated_at=excluded.updated_at`)
          .bind(documentId, page.pageId, candidate.qid, page.title, permanentUrl, page.revisionId, fetchedAt, fetchedAt),
        env.CONTENT_DB.prepare(`INSERT INTO source_document_versions
          (document_id, revision_id, source_wikitext, tocdata_json, content_sha256, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(document_id, revision_id) DO NOTHING`)
          .bind(documentId, page.revisionId, wikitext, JSON.stringify(result.tocdata || []), digest, fetchedAt),
        env.CONTENT_DB.prepare(`INSERT INTO taxon_document_links
          (taxon_id, document_id, relationship, review_status, match_evidence_json, linked_at, updated_at)
          VALUES (?, ?, 'description_source', 'review', ?, ?, ?)
          ON CONFLICT(taxon_id, document_id) DO UPDATE SET
            review_status='review', match_evidence_json=excluded.match_evidence_json,
            updated_at=excluded.updated_at`)
          .bind(taxonId, documentId, evidence, fetchedAt, fetchedAt),
        env.CONTENT_DB.prepare(`INSERT INTO wikipedia_article_extracts
          (document_id, revision_id, lead_text, morphology_text, uses_text, cultivation_text,
           propagation_text, varieties_text, nutrition_text, conservation_status_text, extracted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(document_id, revision_id) DO UPDATE SET
            lead_text=excluded.lead_text,
            morphology_text=excluded.morphology_text,
            uses_text=excluded.uses_text,
            cultivation_text=excluded.cultivation_text,
            propagation_text=excluded.propagation_text,
            varieties_text=excluded.varieties_text,
            nutrition_text=excluded.nutrition_text,
            conservation_status_text=excluded.conservation_status_text,
            extracted_at=excluded.extracted_at`)
          .bind(documentId, page.revisionId, extracted.lead_text, extracted.morphology_text,
            extracted.uses_text, extracted.cultivation_text, extracted.propagation_text,
            extracted.varieties_text, extracted.nutrition_text, extracted.conservation_status_text, fetchedAt),
      ];
      const batch = await env.CONTENT_DB.batch(statements);
      contentWritten = true;
      if (!skipMainStatusUpdate) {
        await env.DB.prepare("UPDATE plant_enrichment_targets SET status = 'review' WHERE taxon_id = ?")
          .bind(taxonId).run();
      }
      return json({
        mode: 'import-one', writesPerformed: true, publicationStatus: 'review',
        target: { taxon_id: taxonId, scientific_name: preview.target.scientific_name },
        source: { documentId, qid: candidate.qid, language: 'zh', title: page.title,
          pageId: page.pageId, revisionId: page.revisionId, permanentUrl,
          license: 'CC BY-SA 4.0', contentSha256: digest, wikitextBytes: new TextEncoder().encode(wikitext).byteLength },
        extracted,
        versionCreated: Number(batch?.[1]?.meta?.changes || 0) > 0,
        notes: ['原始 wikitext 仅作来源快照，尚未清洗或发布。',
          '命名人尚未核验，因此目标状态为 review，而不是 done。'],
      });
    } catch (error) {
      if (error instanceof ImportError) return json({ error: error.message, code: error.code,
        writesPerformed: contentWritten, retrySafe: true }, error.status);
      console.error('Wiki import failed:', error);
      return json({ error: contentWritten
        ? '内容库已幂等写入，但主库状态更新失败；修复后可安全重试。'
        : '本地导入失败；请确认内容库迁移已执行并查看 Wrangler 日志。',
      code: contentWritten ? 'MAIN_STATUS_UPDATE_FAILED' : 'LOCAL_IMPORT_ERROR',
      writesPerformed: contentWritten, retrySafe: true }, 500);
    } finally {
      busy = false;
    }
  };
}

export const handleWikiImport = createWikiImportHandler();
