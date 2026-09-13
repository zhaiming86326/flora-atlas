import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createWikiPreviewHandler } from '../worker/wiki-preview.js';
import { handleRequest } from '../worker/index.js';

const statement = value => ({ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } } });
function entity(id, name, rank, parent, sitelinks = {}) {
  return { id, labels: { en: { value: name } }, sitelinks, claims: {
    P225: [statement(name)], P105: [statement({ id: rank })],
    P171: parent ? [statement({ id: parent })] : [],
  } };
}
function harness(options = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE taxonomic_backbone(taxon_id TEXT PRIMARY KEY, scientific_name TEXT,
    canonical_name TEXT, authorship TEXT, taxon_rank TEXT, family TEXT, genus TEXT,
    normalized_accepted_taxon_id TEXT, is_accepted INTEGER);
    CREATE TABLE plant_enrichment_targets(taxon_id TEXT PRIMARY KEY, lookup_name TEXT, status TEXT);
    CREATE TABLE chinese_taxon_names(taxon_id TEXT PRIMARY KEY, chinese_name TEXT);
    INSERT INTO taxonomic_backbone VALUES ('wcvp:100023','Homalomena occulta','Homalomena occulta',
      '(Lour.) Schott','species','Araceae','Homalomena','wcvp:100023',1);
    INSERT INTO plant_enrichment_targets VALUES ('wcvp:100023','Homalomena occulta','pending');
    INSERT INTO chinese_taxon_names VALUES ('wcvp:100023','测试植物');`);
  const calls = [];
  const entities = {
    Q1: entity('Q1','Homalomena occulta',options.rank || 'Q7432','Q2', {
      zhwiki: { title: '旧标题' }, enwiki: { title: 'Homalomena occulta' },
    }),
    Q2: entity('Q2','Homalomena','Q34740','Q3'),
    Q3: entity('Q3',options.family || 'Araceae','Q35409'),
  };
  if (options.duplicate) entities.Q4 = { ...entities.Q1, id: 'Q4', sitelinks: {} };
  if (options.deprecated) entities.Q1.claims.P225[0].rank = 'deprecated';
  if (options.synonym) {
    entities.Q1.claims.P225 = [statement('Oldname occulta')];
    db.exec(`INSERT INTO taxonomic_backbone VALUES ('wcvp:999','Oldname occulta','Oldname occulta',
      'Author','species','Araceae','Oldname','wcvp:100023',0);`);
  }
  let clock = 10000;
  async function fetchImpl(raw, init) {
    const destination = new URL(raw);
    const url = new URL(destination.hostname === '127.0.0.1' ? destination.searchParams.get('url') : raw);
    calls.push({ url: destination, init, at: clock });
    if (options.bridgeError) return Response.json({error: 'curl exit 7: proxy connection refused'},
      {status: 502, headers: {'x-wiki-bridge-error': '1'}});
    if (options.networkError) throw new TypeError('fetch failed');
    if (options.rateLimit) return new Response('', { status: 429, headers: { 'retry-after': '120' } });
    if (options.invalidJson) return new Response('<html>Error</html>');
    if (options.apiError) return Response.json({ error: { code: 'maxlag' } });
    const p = url.searchParams;
    if (p.get('action') === 'wbsearchentities') {
      return Response.json({ search: options.empty ? [] : [{ id: 'Q1' }, ...(options.duplicate ? [{ id: 'Q4' }] : [])] });
    }
    if (p.get('action') === 'wbgetentities') {
      return Response.json({ entities: Object.fromEntries(p.get('ids').split('|')
        .map(id => [id, options.missingParent && id === 'Q2' ? { id, missing: true } : entities[id]])) });
    }
    const chinese = url.hostname.startsWith('zh.');
    return Response.json({ query: {
      redirects: chinese ? [{ from: '旧标题', to: '新标题' }] : [],
      pages: [{ pageid: 42, ns: 0, title: chinese ? '新标题' : 'Homalomena occulta', lastrevid: 123,
        pageprops: { wikibase_item: options.wrongPage ? 'Q999' : 'Q1',
          ...(options.disambiguation ? { disambiguation: '' } : {}) } }],
    } });
  }
  const env = { WIKI_PREVIEW_ENABLED: 'true', WIKIMEDIA_CONTACT: 'mailto:dev@example.test', DB: {
    prepare(sql) {
      assert.match(sql.trim(), /^SELECT\b/i, 'Preview must never write');
      const stmt = db.prepare(sql);
      return { bind(...params) { return {
        async first() { return stmt.get(...params) ?? null; },
        async all() { return { results: stmt.all(...params) }; },
      }; } };
    },
  } };
  const handler = createWikiPreviewHandler({ fetchImpl, now: () => clock, sleep: async ms => { clock += ms; } });
  return { env, handler, calls, db, async run(suffix = '', override = {}) {
    const res = await handler(new Request('http://127.0.0.1:8787/api/enrichment/preview' + suffix), { ...env, ...override });
    return { res, body: await res.json() };
  } };
}

test('accepted name, rank, genus and family evidence; redirects; no writes; serial pacing', async () => {
  const h = harness();
  try {
    const { res, body } = await h.run();
    assert.equal(res.status, 200); assert.equal(body.result, 'candidate_for_review');
    assert.equal(body.requiresManualReview, true); assert.equal(body.writesPerformed, false);
    assert.equal(body.candidates[0].assessment, 'strong_candidate');
    assert.equal(body.candidates[0].wikipedia[0].title, '新标题');
    assert.ok(body.candidates[0].wikipedia.every(p => p.verified));
    assert.deepEqual(body.candidates[0].wikipedia.map(p => p.language), ['zh']);
    assert.equal(h.db.prepare('SELECT status FROM plant_enrichment_targets').get().status, 'pending');
    assert.ok(h.calls.every(c => c.init.headers['User-Agent'].includes('mailto:dev@example.test')));
    assert.ok(h.calls.slice(1).every((c, i) => c.at - h.calls[i].at >= 1100));
  } finally { h.db.close(); }
});

for (const [name, option] of [
  ['genus page is not species', { rank: 'Q34740' }],
  ['family mismatch', { family: 'Otheraceae' }],
  ['deprecated name is not evidence', { deprecated: true }],
  ['missing ancestry', { missingParent: true }],
  ['multiple strong candidates remain ambiguous', { duplicate: true }],
]) test(name, async () => {
  const h = harness(option);
  try { const { body } = await h.run(); assert.equal(body.result, 'needs_review'); }
  finally { h.db.close(); }
});

for (const option of [{ wrongPage: true }, { disambiguation: true }]) test('page QID/disambiguation verification ' + JSON.stringify(option), async () => {
  const h = harness(option);
  try { const { body } = await h.run(); assert.ok(body.candidates[0].wikipedia.every(p => !p.verified)); }
  finally { h.db.close(); }
});

test('empty search is distinguished from an upstream failure', async () => {
  const h = harness({ empty: true });
  try { const { body } = await h.run(); assert.equal(body.result, 'no_candidates_found'); assert.equal(h.calls.length, 1); }
  finally { h.db.close(); }
});

test('synonym evidence remains review-only', async () => {
  const h = harness({ synonym: true });
  try {
    const { body } = await h.run();
    assert.equal(body.candidates[0].evidence.synonymMatch, true);
    assert.equal(body.candidates[0].assessment, 'needs_review');
    assert.equal(body.result, 'needs_review');
  } finally { h.db.close(); }
});

for (const [option, code] of [
  [{ networkError: true }, 'UPSTREAM_NETWORK_ERROR'],
  [{ invalidJson: true }, 'INVALID_UPSTREAM_JSON'],
  [{ apiError: true }, 'UPSTREAM_RATE_LIMIT'],
]) test('upstream failure: ' + code, async () => {
  const h = harness(option);
  try { const { res, body } = await h.run(); assert.ok(res.status >= 400); assert.equal(body.code, code); }
  finally { h.db.close(); }
});

test('429 Retry-After blocks subsequent outbound requests', async () => {
  const h = harness({ rateLimit: true });
  try {
    const first = await h.run(); assert.equal(first.res.status, 429); assert.equal(first.res.headers.get('retry-after'), '120');
    const second = await h.run(); assert.equal(second.body.code, 'UPSTREAM_COOLDOWN'); assert.equal(h.calls.length, 1);
  } finally { h.db.close(); }
});

test('missing contact, invalid target, absent target and disabled mode cause no outbound calls', async () => {
  const h = harness();
  try {
    assert.equal((await h.run('', { WIKIMEDIA_CONTACT: '' })).body.code, 'CONTACT_REQUIRED');
    assert.equal((await h.run('?taxon_id=bad')).res.status, 400);
    assert.equal((await h.run('?taxon_id=wcvp:999')).res.status, 404);
    assert.equal((await h.run('', { WIKI_PREVIEW_ENABLED: 'false' })).res.status, 404);
    assert.equal(h.calls.length, 0);
  } finally { h.db.close(); }
});

test('concurrent previews rejected instead of increasing Wikimedia concurrency', async () => {
  let release;
  const h = harness();
  const handler = createWikiPreviewHandler({ fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  const request = () => new Request('http://localhost/api/enrichment/preview');
  try {
    const first = handler(request(), h.env);
    while (!release) await new Promise(resolve => setTimeout(resolve, 1));
    const second = await handler(request(), h.env);
    assert.equal(second.status, 429); assert.equal((await second.json()).code, 'PREVIEW_BUSY');
    release(Response.json({ search: [] })); assert.equal((await first).status, 200);
  } finally { h.db.close(); }
});

test('integration preserves health and static-asset routing; preview disabled by default', async () => {
  const health = await handleRequest(new Request('http://localhost/api/health'), {});
  assert.deepEqual(await health.json(), { ok: true, hasDb: false });
  const asset = await handleRequest(new Request('http://localhost/'), { ASSETS: { fetch: () => new Response('asset') } });
  assert.equal(await asset.text(), 'asset');
  const preview = await handleRequest(new Request('http://localhost/api/enrichment/preview'), {});
  assert.equal(preview.status, 404);
});

test('explicit relay wraps every API URL and preserves the preview checks', async () => {
  const h = harness();
  try {
    const { res, body } = await h.run('', {WIKI_PROXY_URL: 'http://127.0.0.1:8790'});
    assert.equal(res.status, 200); assert.equal(body.transport, 'local-curl-proxy');
    assert.equal(body.result, 'candidate_for_review');
    assert.ok(h.calls.every(c => c.url.origin === 'http://127.0.0.1:8790' && c.url.pathname === '/wiki'));
    assert.ok(h.calls.every(c => c.init.headers['X-Wiki-Preview'] === '1'));
  } finally { h.db.close(); }
});

test('relay errors are distinguished from Wikimedia API errors', async () => {
  const h = harness({bridgeError: true});
  try {
    const { body } = await h.run('', {WIKI_PROXY_URL: 'http://127.0.0.1:8790'});
    assert.equal(body.code, 'LOCAL_BRIDGE_ERROR'); assert.match(body.error, /curl exit 7/);
  } finally { h.db.close(); }
});

test('unreachable relay and invalid relay configuration', async () => {
  const h = harness({networkError: true});
  try {
    assert.equal((await h.run('', {WIKI_PROXY_URL: 'https://external.test'})).body.code, 'INVALID_BRIDGE_URL');
    assert.equal(h.calls.length, 0);
    assert.equal((await h.run('', {WIKI_PROXY_URL: 'http://127.0.0.1:8790'})).body.code, 'LOCAL_BRIDGE_UNREACHABLE');
  } finally { h.db.close(); }
});
