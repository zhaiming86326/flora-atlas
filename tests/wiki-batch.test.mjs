import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runWikiImportBatch } from '../worker/wiki-batch.js';

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
  return { prepare: wrap };
}

function harness() {
  const main = new DatabaseSync(':memory:');
  main.exec(`
    CREATE TABLE accepted_species_zh(
      taxon_id TEXT PRIMARY KEY,
      scientific_name TEXT NOT NULL,
      canonical_name TEXT
    );
    CREATE TABLE plant_enrichment_targets(
      taxon_id TEXT PRIMARY KEY,
      lookup_name TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT
    );
    INSERT INTO accepted_species_zh VALUES
      ('wcvp:1', 'Ginkgo biloba', 'Ginkgo biloba'),
      ('wcvp:2', 'Homalomena occulta', 'Homalomena occulta');
  `);
  const content = new DatabaseSync(':memory:');
  content.exec(`
    CREATE TABLE source_documents(document_id TEXT PRIMARY KEY);
    CREATE TABLE source_document_versions(document_id TEXT, revision_id INTEGER);
    CREATE TABLE taxon_document_links(taxon_id TEXT, document_id TEXT);
    CREATE TABLE wiki_import_state(id INTEGER PRIMARY KEY, next_index INTEGER NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO wiki_import_state VALUES (1, 0, '2026-09-13T00:00:00Z');
  `);
  const env = {
    DB: d1(main),
    CONTENT_DB: d1(content),
    WIKIMEDIA_CONTACT: 'https://flora-atlas-green.simcardqrm4.chatgpt.site',
    WIKI_AUTO_SEED_TARGETS: 'true',
    WIKI_BATCH_SIZE: '1',
    WIKI_SEED_BATCH_SIZE: '2',
    WIKI_TARGETS_CSV_URL: '',
  };
  return { main, content, env, close() { main.close(); content.close(); } };
}

test('batch seeds a pending target and imports it', async () => {
  const h = harness();
  try {
    const importHandler = async request => {
      const taxonId = new URL(request.url).searchParams.get('taxon_id');
      h.main.prepare("UPDATE plant_enrichment_targets SET status='review' WHERE taxon_id=?").run(taxonId);
      return Response.json({
        writesPerformed: true,
        source: { documentId: 'wikipedia:zh:1', revisionId: 123 },
      });
    };
    const result = await runWikiImportBatch(h.env, { importHandler });
    assert.equal(result.ok, true);
    assert.equal(result.seeded, 2);
    assert.equal(result.imported, 1);
    assert.equal(h.main.prepare("SELECT status FROM plant_enrichment_targets WHERE taxon_id='wcvp:1'").get().status, 'review');
    assert.equal(h.main.prepare("SELECT status FROM plant_enrichment_targets WHERE taxon_id='wcvp:2'").get().status, 'pending');
  } finally {
    h.close();
  }
});

test('csv manifest imports without reading the main D1 database', async () => {
  const h = harness();
  try {
    let sawFakeDb = false;
    const importHandler = async (request, env) => {
      assert.equal(new URL(request.url).searchParams.get('taxon_id'), 'wcvp:1');
      const row = await env.DB.prepare('SELECT target FROM plant_enrichment_targets e JOIN taxonomic_backbone b').first();
      sawFakeDb = row.lookup_name === 'Ginkgo biloba';
      return Response.json({
        writesPerformed: true,
        source: { documentId: 'wikipedia:zh:1', revisionId: 123 },
      });
    };
    const result = await runWikiImportBatch({ ...h.env, DB: undefined }, {
      importHandler,
      targets: [{
        taxon_id: 'wcvp:1',
        lookup_name: 'Ginkgo biloba',
        scientific_name: 'Ginkgo biloba',
        taxon_rank: 'species',
        family: 'Ginkgoaceae',
        genus: 'Ginkgo',
        chinese_name: '银杏',
      }],
    });
    assert.equal(result.mode, 'wiki-import-csv-batch');
    assert.equal(result.imported, 1);
    assert.equal(result.nextIndex, 1);
    assert.equal(sawFakeDb, true);
    assert.equal(h.content.prepare('SELECT next_index FROM wiki_import_state WHERE id=1').get().next_index, 1);
  } finally {
    h.close();
  }
});

test('permanent matching failure is skipped so later runs can advance', async () => {
  const h = harness();
  try {
    h.main.prepare("INSERT INTO plant_enrichment_targets VALUES ('wcvp:1','Ginkgo biloba','pending',NULL)").run();
    const importHandler = async () => Response.json({
      writesPerformed: false,
      code: 'MATCH_NOT_UNIQUE',
      error: 'not unique',
    }, { status: 409 });
    const result = await runWikiImportBatch(h.env, { importHandler });
    assert.equal(result.skipped, 1);
    assert.equal(h.main.prepare("SELECT status FROM plant_enrichment_targets WHERE taxon_id='wcvp:1'").get().status, 'skipped');
  } finally {
    h.close();
  }
});

test('retryable upstream failure keeps the target pending and stops the run', async () => {
  const h = harness();
  try {
    h.main.prepare("INSERT INTO plant_enrichment_targets VALUES ('wcvp:1','Ginkgo biloba','pending',NULL)").run();
    const importHandler = async () => Response.json({
      writesPerformed: false,
      code: 'UPSTREAM_RATE_LIMIT',
      error: 'retry later',
    }, { status: 429 });
    const result = await runWikiImportBatch(h.env, { importHandler });
    assert.equal(result.stopped, true);
    assert.equal(result.results[0].status, 'retry_later');
    assert.equal(h.main.prepare("SELECT status FROM plant_enrichment_targets WHERE taxon_id='wcvp:1'").get().status, 'pending');
  } finally {
    h.close();
  }
});

test('missing content schema stops before touching pending targets', async () => {
  const h = harness();
  const emptyContent = new DatabaseSync(':memory:');
  try {
    h.main.prepare("INSERT INTO plant_enrichment_targets VALUES ('wcvp:1','Ginkgo biloba','pending',NULL)").run();
    const result = await runWikiImportBatch({ ...h.env, CONTENT_DB: d1(emptyContent) });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SCHEMA_NOT_READY');
    assert.equal(h.main.prepare("SELECT status FROM plant_enrichment_targets WHERE taxon_id='wcvp:1'").get().status, 'pending');
  } finally {
    emptyContent.close();
    h.close();
  }
});
