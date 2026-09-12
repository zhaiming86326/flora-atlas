import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/index.js';

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.bound = [];
  }

  bind(...values) {
    this.bound = values;
    this.db.calls.push({ sql: this.sql, values });
    return this;
  }

  async first() {
    if (this.sql.includes('COUNT(*) AS count')) return { count: 130 };
    if (this.sql.includes('COUNT(*) AS total')) return { total: 130 };
    if (this.sql.includes('WHERE t.taxon_id = ?')) return { taxon_id: this.bound[0], wcvp_id: '334053', scientific_name: 'Ginkgo biloba', family: 'Ginkgoaceae', genus: 'Ginkgo' };
    return null;
  }

  async all() {
    if (this.sql.includes('GROUP BY t.family')) return { results: [{ id: 'Ginkgoaceae', name: 'Ginkgoaceae', zh: '银杏科', count: 1 }] };
    if (this.sql.includes('ORDER BY') && this.sql.includes('LIMIT ? OFFSET ?')) return { results: [{ taxon_id: 'wcvp:334053', wcvp_id: '334053', scientific_name: 'Ginkgo biloba', family: 'Ginkgoaceae', genus: 'Ginkgo' }] };
    if (this.sql.trim().startsWith('SELECT source_db')) return { results: [{ source_db: 'WCVP', external_id: '334053', match_type: 'BACKBONE' }] };
    if (this.sql.trim().startsWith('SELECT trait_name')) return { results: [{ trait_name: 'lifeform', trait_value: 'tree', raw_value: 'tree', source_db: 'WCVP', confidence_score: 1 }] };
    if (this.sql.trim().startsWith('SELECT synonym_taxon_id')) return { results: [] };
    return { results: [] };
  }
}

class FakeD1 {
  constructor() {
    this.calls = [];
  }

  prepare(sql) {
    return new Statement(this, sql);
  }
}

async function body(response) {
  return response.json();
}

test('health endpoint works before D1 is configured', async () => {
  const response = await handleRequest(new Request('https://example.test/api/health'), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await body(response), { ok: true, hasDb: false });
});

test('API responds to CORS preflight', async () => {
  const response = await handleRequest(new Request('https://example.test/api/plants', { method: 'OPTIONS' }), {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});

test('plant list clamps pagination and uses bound values', async () => {
  const db = new FakeD1();
  const response = await handleRequest(new Request('https://example.test/api/plants?q=ＧＩＮＫＧＯ&group=gymnosperms&family=wfo-family&limit=500&offset=-8'), { DB: db });
  const payload = await body(response);

  assert.equal(response.status, 200);
  assert.equal(payload.total, 130);
  assert.equal(payload.page, 1);
  assert.equal(payload.pageSize, 60);
  assert.equal(payload.pages, 3);
  assert.equal(payload.offset, 0);
  assert.equal(payload.hasPrev, false);
  assert.equal(payload.hasNext, true);
  assert.equal(payload.nextOffset, 60);
  assert.equal(payload.items[0].taxonId, 'wcvp:334053');
  assert.equal(payload.items[0].imageUrl, 'https://pub-3517da5ed83f46628c557cd926a014a5.r2.dev/imgs/ginkgo-biloba.webp');
  assert(db.calls.some(call => call.sql.includes('synonym_to_accepted sn')));
  assert(db.calls.some(call => call.sql.includes('accepted_species_zh t')));
  assert(db.calls.some(call => call.values.includes('%ginkgo%')));
  assert(db.calls.some(call => call.values.at(-2) === 60 && call.values.at(-1) === 0));
});

test('plant list clamps an out-of-range offset to the last page', async () => {
  const response = await handleRequest(new Request('https://example.test/api/plants?limit=50&offset=9999'), { DB: new FakeD1() });
  const payload = await body(response);

  assert.equal(response.status, 200);
  assert.equal(payload.total, 130);
  assert.equal(payload.page, 3);
  assert.equal(payload.pages, 3);
  assert.equal(payload.offset, 100);
  assert.equal(payload.hasPrev, true);
  assert.equal(payload.hasNext, false);
  assert.equal(payload.prevOffset, 50);
  assert.equal(payload.nextOffset, null);
});

test('summary, families and detail endpoints return shaped JSON', async () => {
  const db = new FakeD1();
  const summary = await handleRequest(new Request('https://example.test/api/summary'), { DB: db });
  const families = await handleRequest(new Request('https://example.test/api/families'), { DB: db });
  const detail = await handleRequest(new Request('https://example.test/api/plants/wcvp%3A334053'), { DB: db });

  assert.equal((await body(summary)).stats.plants, 130);
  assert.deepEqual((await body(families)).items, [{ id: 'Ginkgoaceae', name: 'Ginkgoaceae', zh: '银杏科', count: 1 }]);
  assert.equal(detail.status, 200);
  assert.equal((await body(detail)).item.taxonId, 'wcvp:334053');
});

test('D1 routes fail clearly when DB is absent', async () => {
  const response = await handleRequest(new Request('https://example.test/api/plants'), {});
  assert.equal(response.status, 503);
  assert.equal((await body(response)).error, 'D1 binding DB is not configured.');
});
