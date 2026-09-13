import { createWikiImportHandler } from './wiki-import.js';

const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_SEED_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 5;
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

function cloudImportEnv(env) {
  return {
    ...env,
    WIKI_PREVIEW_ENABLED: 'true',
    WIKI_IMPORT_ENABLED: 'true',
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
  const [targets, documents, versions, links] = await Promise.all([
    tableExists(env.DB, 'plant_enrichment_targets'),
    tableExists(env.CONTENT_DB, 'source_documents'),
    tableExists(env.CONTENT_DB, 'source_document_versions'),
    tableExists(env.CONTENT_DB, 'taxon_document_links'),
  ]);
  return targets && documents && versions && links;
}

export async function runWikiImportBatch(env, options = {}) {
  if (!env.DB || !env.CONTENT_DB) {
    return { ok: false, code: 'DB_NOT_CONFIGURED', error: 'DB and CONTENT_DB bindings are required.' };
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
