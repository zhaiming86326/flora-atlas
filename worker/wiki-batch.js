import { createWikiImportHandler } from './wiki-import.js';

const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_SEED_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 5;
const DEFAULT_TARGET_CSV_URL = 'https://raw.githubusercontent.com/zhaiming86326/flora-atlas/main/db/import/wiki-enrichment-targets.csv';
const RETRYABLE_CODES = new Set([
  'UPSTREAM_RATE_LIMIT',
  'UPSTREAM_COOLDOWN',
  'UPSTREAM_NETWORK_ERROR',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_HTTP_ERROR',
  'UPSTREAM_API_ERROR',
  'LOCAL_BRIDGE_UNREACHABLE',
  'LOCAL_BRIDGE_ERROR',
  'INVALID_UPSTREAM_JSON',
]);
const SKIPPED_CODES = new Set([
  'MATCH_NOT_UNIQUE',
  'ZH_PAGE_NOT_VERIFIED',
  'INVALID_TARGET',
  'TARGET_NOT_FOUND',
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function parsePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function cloudImportEnv(env, { skipMainStatusUpdate = false } = {}) {
  return {
    ...env,
    WIKI_PREVIEW_ENABLED: 'true',
    WIKI_IMPORT_ENABLED: 'true',
    WIKI_IMPORT_SKIP_MAIN_STATUS_UPDATE: skipMainStatusUpdate ? 'true' : '',
    WIKI_PROXY_URL: '',
  };
}

async function seedPendingTargets(env, limit) {
  if (String(env.WIKI_AUTO_SEED_TARGETS || '').toLowerCase() !== 'true') return 0;
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO plant_enrichment_targets (taxon_id, lookup_name, status, updated_at)
    SELECT t.taxon_id, coalesce(t.canonical_name, t.scientific_name), 'pending', datetime('now')
    FROM accepted_species_zh t
    WHERE NOT EXISTS (
      SELECT 1 FROM plant_enrichment_targets e WHERE e.taxon_id = t.taxon_id
    )
    ORDER BY t.taxon_id
    LIMIT ?
  `).bind(limit).run();
  return Number(result?.meta?.changes || 0);
}

async function selectPendingTargets(env, limit) {
  const rows = await env.DB.prepare(`
    SELECT taxon_id
    FROM plant_enrichment_targets
    WHERE status = 'pending'
    ORDER BY taxon_id
    LIMIT ?
  `).bind(limit).all();
  return rows.results ?? [];
}

async function markTarget(env, taxonId, status) {
  await env.DB.prepare(`
    UPDATE plant_enrichment_targets
    SET status = ?, updated_at = datetime('now')
    WHERE taxon_id = ?
  `).bind(status, taxonId).run();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(values => values.some(value => value !== ''));
}

function csvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(header => header.trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
    .filter(row => /^wcvp:\d{1,30}$/.test(row.taxon_id || '') && row.lookup_name);
}

async function loadCsvTargets(env, options = {}) {
  if (Array.isArray(options.targets)) return options.targets;
  if (typeof options.csv === 'string') return csvRecords(options.csv);
  if (env.WIKI_TARGETS_CSV) return csvRecords(env.WIKI_TARGETS_CSV);
  const configuredUrl = Object.hasOwn(env, 'WIKI_TARGETS_CSV_URL') ? env.WIKI_TARGETS_CSV_URL : DEFAULT_TARGET_CSV_URL;
  const url = String(configuredUrl || '').trim();
  if (!url) return null;
  const response = await fetch(url, {
    headers: { 'User-Agent': `FloraAtlasEnrichment/0.1 (${String(env.WIKIMEDIA_CONTACT || '').trim()})` },
  });
  if (!response.ok) throw new Error(`Failed to load target CSV: HTTP ${response.status}`);
  return csvRecords(await response.text());
}

function fakeDbForTarget(target) {
  const targetRow = {
    taxon_id: target.taxon_id,
    lookup_name: target.lookup_name || target.scientific_name || target.canonical_name,
    status: 'pending',
    scientific_name: target.scientific_name || target.lookup_name,
    canonical_name: target.lookup_name || target.scientific_name,
    authorship: target.authorship || '',
    taxon_rank: target.taxon_rank || 'species',
    family: target.family || '',
    genus: target.genus || '',
    normalized_accepted_taxon_id: target.taxon_id,
    is_accepted: 1,
  };
  return {
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (sql.includes('FROM plant_enrichment_targets e JOIN taxonomic_backbone b')) return targetRow;
          return null;
        },
        async all() {
          if (sql.includes('FROM chinese_taxon_names')) {
            return { results: target.chinese_name ? [{ chinese_name: target.chinese_name, taxon_id: target.taxon_id }] : [] };
          }
          if (sql.includes('FROM taxonomic_backbone WHERE normalized_accepted_taxon_id')) return { results: [] };
          return { results: [] };
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };
}

async function getCsvQueueIndex(db) {
  const row = await db.prepare('SELECT next_index FROM wiki_import_state WHERE id = 1').first();
  return Number(row?.next_index || 0);
}

async function setCsvQueueIndex(db, nextIndex) {
  await db.prepare(`
    INSERT INTO wiki_import_state (id, next_index, updated_at)
    VALUES (1, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET next_index = excluded.next_index, updated_at = excluded.updated_at
  `).bind(nextIndex).run();
}

function authorized(request, env) {
  const secret = String(env.ENRICHMENT_RUN_SECRET || '').trim();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

async function tableExists(db, name) {
  const row = await db.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).bind(name).first();
  return Boolean(row);
}

async function requiredTablesReady(env) {
  const [documents, versions, links, state] = await Promise.all([
    tableExists(env.CONTENT_DB, 'source_documents'),
    tableExists(env.CONTENT_DB, 'source_document_versions'),
    tableExists(env.CONTENT_DB, 'taxon_document_links'),
    tableExists(env.CONTENT_DB, 'wiki_import_state'),
  ]);
  return documents && versions && links && state;
}

async function runCsvBatch(env, options, targets) {
  const limit = parsePositiveInt(options.limit ?? env.WIKI_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const importHandler = options.importHandler || createWikiImportHandler();
  let index = await getCsvQueueIndex(env.CONTENT_DB);
  const selected = targets.slice(index, index + limit);
  const results = [];
  let imported = 0;
  let skipped = 0;
  let stopped = false;

  for (const target of selected) {
    const taxonId = target.taxon_id;
    const request = new Request(`http://localhost/api/enrichment/import?taxon_id=${encodeURIComponent(taxonId)}`, {
      method: 'POST',
      headers: { 'X-Flora-Confirm': 'import-one' },
    });
    const response = await importHandler(request, { ...cloudImportEnv(env, { skipMainStatusUpdate: true }), DB: fakeDbForTarget(target) });
    const body = await response.json();
    if (response.ok && body.writesPerformed) {
      imported += 1;
      index += 1;
      results.push({ taxonId, csvIndex: index - 1, status: 'imported', source: body.source });
      continue;
    }

    const code = body.code || 'UNKNOWN_IMPORT_ERROR';
    if (SKIPPED_CODES.has(code)) {
      skipped += 1;
      index += 1;
      results.push({ taxonId, csvIndex: index - 1, status: 'skipped', code, error: body.error });
      continue;
    }
    results.push({ taxonId, csvIndex: index, status: RETRYABLE_CODES.has(code) ? 'retry_later' : 'error', code, error: body.error });
    if (!RETRYABLE_CODES.has(code)) index += 1;
    stopped = true;
    break;
  }
  await setCsvQueueIndex(env.CONTENT_DB, index);
  return { limit, selected, imported, skipped, stopped, nextIndex: index, totalTargets: targets.length, results };
}

export async function runWikiImportBatch(env, options = {}) {
  if (!env.CONTENT_DB) {
    return { ok: false, code: 'DB_NOT_CONFIGURED', error: 'CONTENT_DB binding is required.' };
  }
  const contact = String(env.WIKIMEDIA_CONTACT || '').trim();
  if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(contact)) {
    return { ok: false, code: 'CONTACT_REQUIRED', error: 'WIKIMEDIA_CONTACT must be a real mailto: or HTTPS URL.' };
  }
  if (!await requiredTablesReady(env)) {
    return {
      ok: false,
      code: 'SCHEMA_NOT_READY',
      error: 'Run the main and content D1 migrations before enabling Wikimedia enrichment.',
    };
  }

  const csvTargets = await loadCsvTargets(env, options);
  if (csvTargets) {
    const runStartedAt = new Date().toISOString();
    const result = await runCsvBatch(env, options, csvTargets);
    return {
      ok: true,
      mode: 'wiki-import-csv-batch',
      runStartedAt,
      batchSize: result.limit,
      selected: result.selected.length,
      imported: result.imported,
      skipped: result.skipped,
      stopped: result.stopped,
      nextIndex: result.nextIndex,
      totalTargets: result.totalTargets,
      results: result.results,
    };
  }

  if (!env.DB) {
    return { ok: false, code: 'DB_NOT_CONFIGURED', error: 'DB binding is required when no CSV target manifest is configured.' };
  }

  const limit = parsePositiveInt(options.limit ?? env.WIKI_BATCH_SIZE, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const seedLimit = parsePositiveInt(env.WIKI_SEED_BATCH_SIZE, DEFAULT_SEED_BATCH_SIZE, 100);
  const importHandler = options.importHandler || createWikiImportHandler();
  const runStartedAt = new Date().toISOString();
  let seeded = 0;
  let targets = await selectPendingTargets(env, limit);
  if (!targets.length) {
    seeded = await seedPendingTargets(env, seedLimit);
    targets = await selectPendingTargets(env, limit);
  }

  const results = [];
  let imported = 0;
  let skipped = 0;
  let stopped = false;

  for (const target of targets) {
    const taxonId = target.taxon_id;
    const request = new Request(`http://localhost/api/enrichment/import?taxon_id=${encodeURIComponent(taxonId)}`, {
      method: 'POST',
      headers: { 'X-Flora-Confirm': 'import-one' },
    });
    const response = await importHandler(request, cloudImportEnv(env));
    const body = await response.json();
    if (response.ok && body.writesPerformed) {
      imported += 1;
      results.push({ taxonId, status: 'imported', source: body.source });
      continue;
    }

    const code = body.code || 'UNKNOWN_IMPORT_ERROR';
    if (SKIPPED_CODES.has(code)) {
      await markTarget(env, taxonId, 'skipped');
      skipped += 1;
      results.push({ taxonId, status: 'skipped', code, error: body.error });
      continue;
    }
    if (!RETRYABLE_CODES.has(code)) {
      await markTarget(env, taxonId, 'error');
    }
    results.push({ taxonId, status: RETRYABLE_CODES.has(code) ? 'retry_later' : 'error', code, error: body.error });
    stopped = true;
    break;
  }

  return {
    ok: true,
    mode: 'wiki-import-batch',
    runStartedAt,
    batchSize: limit,
    seeded,
    selected: targets.length,
    imported,
    skipped,
    stopped,
    results,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, hasDb: Boolean(env.DB), hasContentDb: Boolean(env.CONTENT_DB) });
    }
    if (request.method !== 'POST' || url.pathname !== '/api/enrichment/batch') {
      return json({ error: 'Not found' }, 404);
    }
    if (!authorized(request, env)) {
      return json({ error: 'Manual batch import is disabled or unauthorized.', code: 'UNAUTHORIZED' }, 401);
    }
    const limit = url.searchParams.get('limit');
    return json(await runWikiImportBatch(env, { limit }));
  },

  async scheduled(controller, env, ctx) {
    const task = runWikiImportBatch(env, { reason: 'scheduled', cron: controller.cron })
      .then(result => console.log('wiki import batch', JSON.stringify(result)))
      .catch(error => console.error('wiki import batch failed', error));
    ctx.waitUntil(task);
  },
};
