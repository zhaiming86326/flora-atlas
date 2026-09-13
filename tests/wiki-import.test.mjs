import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createWikiImportHandler } from '../worker/wiki-import.js';
import { handleRequest } from '../worker/index.js';

function d1(database) {
  function wrap(sql) {
    const statement = database.prepare(sql);
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return statement.get(...this.args) ?? null; },
      async all() { return { results: statement.all(...this.args) }; },
      async run() {
        const result = statement.run(...this.args);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare: wrap,
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function preview(overrides = {}) {
  const page = { language: 'zh', title: '千年健', pageId: 982995, revisionId: 80454016,
    url: 'https://zh.wikipedia.org/wiki/千年健', exists: true, disambiguation: false,
    qidMatches: true, verified: true, ...overrides.page };
  return { mode: 'preview', writesPerformed: false,
    target: { taxon_id: 'wcvp:100023', scientific_name: 'Homalomena occulta' },
    result: 'candidate_for_review', candidates: [{ qid: 'Q6851075', assessment: 'strong_candidate',
      evidence: { acceptedNameMatch: true, rankMatch: true, genusMatch: true, familyMatch: true,
        authorshipChecked: false }, wikipedia: [page] }], ...overrides };
}

function harness(options = {}) {
  const main = new DatabaseSync(':memory:');
  const content = new DatabaseSync(':memory:');
  main.exec(`CREATE TABLE plant_enrichment_targets(taxon_id TEXT PRIMARY KEY, status TEXT NOT NULL);
    INSERT INTO plant_enrichment_targets VALUES ('wcvp:100023', 'pending');`);
  content.exec(readFileSync(new URL('../migrations/content/0001_wikipedia_sources.sql', import.meta.url), 'utf8'));
  content.exec(readFileSync(new URL('../migrations/content/0003_wikipedia_article_extracts.sql', import.meta.url), 'utf8'));
  const calls = [];
  const previewBody = options.previewBody || preview();
  const previewHandler = async () => Response.json(previewBody, { status: options.previewStatus || 200 });
  const fetchImpl = async (raw, init) => {
    const outer = new URL(raw);
    const upstream = new URL(outer.hostname === '127.0.0.1' ? outer.searchParams.get('url') : raw);
    calls.push({ outer, upstream, init });
    return Response.json(options.parseBody || { parse: {
      title: '千年健', pageid: 982995, revid: options.revisionId || 80454016,
      wikitext: options.wikitext || `{{Speciesbox|status=LC}}
'''千年健'''（学名：Homalomena occulta）是天南星科植物。

== 形态 ==
多年生草本，根茎匍匐。

== 用途 ==
可作药用。

== 栽培 ==
喜温暖湿润环境。

== 繁殖 ==
可分株繁殖。

== 变种 ==
有若干变种记录。

== 每100 g（3.5 oz）食物营养值 ==
能量 100 千焦。

== 保护状况 ==
无危。`,
      tocdata: { sections: [{ toclevel: 1, line: '形态' }] },
    } });
  };
  const handler = createWikiImportHandler({ previewHandler, fetchImpl,
    now: () => new Date('2026-09-12T12:00:00.000Z') });
  const env = { WIKI_IMPORT_ENABLED: 'true', WIKI_PREVIEW_ENABLED: 'true',
    WIKIMEDIA_CONTACT: 'mailto:dev@example.test', WIKI_PROXY_URL: 'http://127.0.0.1:8790',
    DB: d1(main), CONTENT_DB: d1(content) };
  async function run(overrides = {}, headers = { 'X-Flora-Confirm': 'import-one' }) {
    const response = await handler(new Request(
      'http://127.0.0.1:8787/api/enrichment/import?taxon_id=wcvp%3A100023',
      { method: 'POST', headers }), { ...env, ...overrides });
    return { response, body: await response.json() };
  }
  return { main, content, calls, handler, env, run, close() { main.close(); content.close(); } };
}

test('imports exactly the locked revision as review-only source data', async () => {
  const h = harness();
  try {
    const { response, body } = await h.run();
    assert.equal(response.status, 200);
    assert.equal(body.writesPerformed, true);
    assert.equal(body.publicationStatus, 'review');
    assert.equal(body.source.revisionId, 80454016);
    assert.equal(body.versionCreated, true);
    assert.equal(h.main.prepare('SELECT status FROM plant_enrichment_targets').get().status, 'review');
    const source = h.content.prepare('SELECT * FROM source_documents').get();
    assert.equal(source.document_id, 'wikipedia:zh:982995');
    assert.equal(source.match_status, 'matched_unreviewed');
    assert.equal(source.canonical_url, 'https://zh.wikipedia.org/w/index.php?oldid=80454016');
    const version = h.content.prepare('SELECT * FROM source_document_versions').get();
    assert.equal(version.revision_id, 80454016);
    assert.equal(version.content_sha256.length, 64);
    assert.match(version.source_wikitext, /Homalomena occulta/);
    assert.equal(h.content.prepare('SELECT review_status FROM taxon_document_links').get().review_status, 'review');
    const extract = h.content.prepare('SELECT * FROM wikipedia_article_extracts').get();
    assert.match(extract.lead_text, /千年健/);
    assert.match(extract.morphology_text, /根茎匍匐/);
    assert.match(extract.uses_text, /药用/);
    assert.match(extract.cultivation_text, /温暖湿润/);
    assert.match(extract.propagation_text, /分株繁殖/);
    assert.match(extract.varieties_text, /变种记录/);
    assert.match(extract.nutrition_text, /100 千焦/);
    assert.match(extract.conservation_status_text, /无危/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].upstream.searchParams.get('action'), 'parse');
    assert.equal(h.calls[0].upstream.searchParams.get('oldid'), '80454016');
    assert.match(h.calls[0].upstream.searchParams.get('prop'), /tocdata/);
    assert.equal(h.calls[0].outer.origin, 'http://127.0.0.1:8790');
  } finally { h.close(); }
});

test('repeating an import is idempotent and creates no duplicate version', async () => {
  const h = harness();
  try {
    assert.equal((await h.run()).body.versionCreated, true);
    assert.equal((await h.run()).body.versionCreated, false);
    assert.equal(h.content.prepare('SELECT count(*) AS n FROM source_documents').get().n, 1);
    assert.equal(h.content.prepare('SELECT count(*) AS n FROM source_document_versions').get().n, 1);
    assert.equal(h.content.prepare('SELECT count(*) AS n FROM taxon_document_links').get().n, 1);
  } finally { h.close(); }
});

test('revision mismatch stops before any database write', async () => {
  const h = harness({ revisionId: 80454017 });
  try {
    const { response, body } = await h.run();
    assert.equal(response.status, 409);
    assert.equal(body.code, 'REVISION_MISMATCH');
    assert.equal(body.writesPerformed, false);
    assert.equal(h.content.prepare('SELECT count(*) AS n FROM source_documents').get().n, 0);
    assert.equal(h.main.prepare('SELECT status FROM plant_enrichment_targets').get().status, 'pending');
  } finally { h.close(); }
});

test('ambiguous preview, missing confirmation, and disabled mode perform no write', async () => {
  const ambiguous = preview({ result: 'needs_review' });
  const h = harness({ previewBody: ambiguous });
  try {
    assert.equal((await h.run()).body.code, 'MATCH_NOT_UNIQUE');
    assert.equal((await h.run({}, {})).body.code, 'CONFIRMATION_REQUIRED');
    assert.equal((await h.run({ WIKI_IMPORT_ENABLED: 'false' })).body.code, 'IMPORT_DISABLED');
    assert.equal(h.calls.length, 0);
    assert.equal(h.content.prepare('SELECT count(*) AS n FROM source_documents').get().n, 0);
  } finally { h.close(); }
});

test('worker route keeps import disabled unless explicitly enabled', async () => {
  const response = await handleRequest(new Request('http://localhost/api/enrichment/import', { method: 'POST' }), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'IMPORT_DISABLED');
});
