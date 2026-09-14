import { handleWikiPreview } from './wiki-preview.js';
import { handleWikiImport } from './wiki-import.js';

const R2_IMAGE_PREFIX = 'https://pub-3517da5ed83f46628c557cd926a014a5.r2.dev/imgs';
const GROUPS = [
  { id: 'vascular_plant', name: '维管植物', latin: 'Tracheophytes' },
];
const LIFEFORM_FILTERS = [
  { id: 'tree', name: '乔木', patterns: ['%tree%'] },
  { id: 'shrub', name: '灌木', patterns: ['%shrub%'] },
  { id: 'herb', name: '草本', patterns: ['%herb%', '%annual%', '%biennial%', '%perennial%', '%geophyte%', '%helophyte%'] },
  { id: 'climber', name: '藤本', patterns: ['%climber%', '%liana%', '%vine%'] },
  { id: 'wetland', name: '水生/湿生植物', patterns: ['%aquatic%', '%helophyte%', '%hydrophyte%'] },
  { id: 'epiphyte', name: '附生植物', patterns: ['%epiphyte%'] },
  { id: 'annual', name: '一年生植物', patterns: ['%annual%'] },
  { id: 'perennial', name: '多年生植物', patterns: ['%perennial%'] },
];
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
const clampLimit = value => Math.min(60, Math.max(1, Number.parseInt(value || '24', 10) || 24));
const parseOffset = value => Math.max(0, Number.parseInt(value || '0', 10) || 0);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function codedError(code, message, status = 400) {
  return json({ error: message, code }, status);
}

function isD1DailyLimitError(caught) {
  return String(caught?.message || caught || '').includes('exceeded D1') ||
    String(caught?.message || caught || '').includes('daily row read limit') ||
    String(caught?.message || caught || '').includes('[code: 7500]');
}

function requireDb(env) {
  if (!env.DB) throw new Response(JSON.stringify({ error: 'D1 binding DB is not configured.' }), {
    status: 503,
    headers: jsonHeaders,
  });
  return env.DB;
}

function imageUrl(scientificName, env) {
  const prefix = env.R2_IMAGE_PREFIX || R2_IMAGE_PREFIX;
  const ext = env.R2_IMAGE_EXTENSION || 'webp';
  const file = String(scientificName || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '-');
  return `${prefix}/${encodeURIComponent(file)}.${ext}`;
}

function mapListRow(row, env) {
  const familyName = row.family || '';
  const genusName = row.genus || '';
  return {
    taxonId: row.taxon_id,
    slug: row.taxon_id,
    wcvpId: row.wcvp_id || '',
    wfoId: row.wfo_id || '',
    gbifId: row.gbif_id || '',
    ncbiTaxid: row.ncbi_taxid || '',
    ipniId: row.ipni_id || '',
    powoId: row.powo_id || '',
    scientificName: row.scientific_name,
    canonicalName: row.canonical_name || row.scientific_name,
    chineseName: row.chinese_name || '',
    authorship: row.authorship || '',
    rank: row.taxon_rank || 'species',
    group: 'vascular_plant',
    family: {
      id: row.family || '',
      name: familyName,
      zh: row.chinese_family || familyName,
    },
    genus: {
      id: row.genus || '',
      name: genusName,
      zh: row.chinese_genus || genusName,
    },
    lifeform: row.lifeform || '',
    climate: row.climate || '',
    geographicArea: row.geographic_area || '',
    tagline: row.lifeform || row.geographic_area || '',
    description: row.geographic_area || '',
    imageUrl: row.image_url || imageUrl(row.scientific_name, env),
  };
}

function readPlantParams(url) {
  const p = url.searchParams;
  return {
    q: normalize(p.get('q')),
    lifeforms: (p.get('lifeform') || '').split(',').map(normalize).filter(Boolean),
    family: p.get('family') || '',
    sort: p.get('sort') || 'default',
    limit: clampLimit(p.get('limit')),
    offset: parseOffset(p.get('offset')),
  };
}

function plantWhere(params) {
  const where = [];
  const binds = [];

  if (params.q) {
    where.push(`(
      lower(t.scientific_name) LIKE ?
      OR lower(coalesce(t.canonical_name, '')) LIKE ?
      OR lower(coalesce(t.chinese_name, '')) LIKE ?
      OR EXISTS (
        SELECT 1 FROM synonym_to_accepted sn
        WHERE sn.accepted_taxon_id = t.taxon_id
          AND lower(sn.synonym_name) LIKE ?
      )
    )`);
    const like = `%${params.q}%`;
    binds.push(like, like, like, like);
  }
  if (params.lifeforms?.length) {
    const filters = LIFEFORM_FILTERS.filter(filter => params.lifeforms.includes(filter.id));
    if (filters.length) {
      const clauses = filters.flatMap(filter => filter.patterns.map(() => "lower(ta.trait_value) LIKE ?"));
      where.push(`EXISTS (
        SELECT 1 FROM trait_assertions ta
        WHERE ta.taxon_id = t.taxon_id
          AND ta.trait_name = 'lifeform'
          AND (${clauses.join(' OR ')})
      )`);
      binds.push(...filters.flatMap(filter => filter.patterns));
    }
  }
  if (params.family) {
    where.push('(t.family = ? OR t.chinese_family = ?)');
    binds.push(params.family, params.family);
  }

  return { sql: where.length ? where.join(' AND ') : '1 = 1', binds };
}

function orderBy(sort) {
  if (sort === 'latin') return 'coalesce(t.canonical_name, t.scientific_name) COLLATE NOCASE ASC, t.taxon_id ASC';
  return `
    coalesce(nullif(t.chinese_sort_key, ''), t.chinese_name) COLLATE NOCASE ASC,
    coalesce(t.canonical_name, t.scientific_name) COLLATE NOCASE ASC,
    t.taxon_id ASC
  `;
}

function speciesFrom() {
  return `
    FROM accepted_species_zh t
  `;
}

async function getFamilies(db) {
  const rows = await db.prepare(`
    SELECT
      t.family AS id,
      t.family AS name,
      coalesce(max(t.chinese_family), t.family) AS zh,
      COUNT(*) AS count
    FROM accepted_species_zh t
    WHERE t.family IS NOT NULL
    GROUP BY t.family
    ORDER BY zh COLLATE NOCASE ASC, name COLLATE NOCASE ASC
  `).all();
  return rows.results ?? [];
}

async function getCachedSummary(db) {
  const [statsRow, familyRows, lifeformRows] = await Promise.all([
    db.prepare('SELECT plants, families FROM catalog_summary_stats WHERE id = 1').first(),
    db.prepare('SELECT id, name, zh, count FROM catalog_summary_families ORDER BY sort_order ASC, zh COLLATE NOCASE ASC, name COLLATE NOCASE ASC').all(),
    db.prepare('SELECT id, name, count FROM catalog_summary_lifeforms ORDER BY sort_order ASC').all(),
  ]);
  const families = familyRows.results ?? [];
  const lifeforms = lifeformRows.results ?? [];
  if (!statsRow || !families.length) return null;
  return {
    stats: { plants: statsRow.plants ?? 0, families: statsRow.families ?? families.length },
    groups: GROUPS,
    lifeforms: lifeforms.length ? lifeforms : LIFEFORM_FILTERS.map(filter => ({ id: filter.id, name: filter.name, count: 0 })),
    families,
  };
}

async function getLiveSummary(db) {
  const species = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM accepted_species_zh
  `).first();
  const families = await getFamilies(db);
  const lifeforms = await Promise.all(LIFEFORM_FILTERS.map(async filter => {
    const clauses = filter.patterns.map(() => "lower(ta.trait_value) LIKE ?").join(' OR ');
    const row = await db.prepare(`
      SELECT COUNT(DISTINCT ta.taxon_id) AS count
      FROM trait_assertions ta
      JOIN accepted_species_zh t ON t.taxon_id = ta.taxon_id
      WHERE ta.trait_name = 'lifeform'
        AND (${clauses})
    `).bind(...filter.patterns).first();
    return { id: filter.id, name: filter.name, count: row?.count ?? 0 };
  }));
  return {
    stats: { plants: species?.count ?? 0, families: families.length },
    groups: GROUPS,
    lifeforms,
    families,
  };
}

async function getSummary(db) {
  try {
    const cached = await getCachedSummary(db);
    if (cached) return cached;
  } catch (caught) {
    if (isD1DailyLimitError(caught)) throw caught;
    // Cache tables may not exist yet; fall back to the live aggregate path.
  }
  return getLiveSummary(db);
}

async function getCachedTotal(db, params) {
  if (params.q || params.lifeforms?.length) return null;
  if (params.family) {
    const row = await db.prepare('SELECT count FROM catalog_summary_families WHERE id = ? OR zh = ? LIMIT 1')
      .bind(params.family, params.family).first();
    return row?.count ?? null;
  }
  const row = await db.prepare('SELECT plants FROM catalog_summary_stats WHERE id = 1').first();
  return row?.plants ?? null;
}

async function listPlants(db, params, env) {
  const where = plantWhere(params);
  const from = speciesFrom();
  let total = null;
  try {
    total = await getCachedTotal(db, params);
  } catch (caught) {
    if (isD1DailyLimitError(caught)) throw caught;
  }
  if (total === null) {
    const totalRow = await db.prepare(`SELECT COUNT(*) AS total ${from} WHERE ${where.sql}`).bind(...where.binds).first();
    total = totalRow?.total ?? 0;
  }
  const pages = Math.max(1, Math.ceil(total / params.limit));
  const requestedPage = Math.floor(params.offset / params.limit) + 1;
  const page = Math.max(1, Math.min(pages, requestedPage));
  const offset = (page - 1) * params.limit;
  const rows = await db.prepare(`
    SELECT
      t.taxon_id,
      t.wcvp_id,
      t.scientific_name,
      t.canonical_name,
      t.authorship,
      t.taxon_rank,
      t.family,
      t.genus,
      t.geographic_area,
      t.chinese_name,
      t.chinese_family,
      t.chinese_genus
    ${from}
    WHERE ${where.sql}
    ORDER BY ${orderBy(params.sort)}
    LIMIT ? OFFSET ?
  `).bind(...where.binds, params.limit, offset).all();

  return {
    items: (rows.results ?? []).map(row => mapListRow(row, env)),
    total,
    page,
    pageSize: params.limit,
    pages,
    offset,
    hasPrev: page > 1,
    hasNext: page < pages,
    prevOffset: page > 1 ? offset - params.limit : null,
    nextOffset: page < pages ? offset + params.limit : null,
  };
}

async function getPlant(db, taxonId, env) {
  const row = await db.prepare(`
    SELECT
      t.*,
      t.chinese_name,
      t.chinese_family,
      t.chinese_genus,
      (SELECT group_concat(DISTINCT external_id) FROM external_ids WHERE taxon_id = t.taxon_id AND source_db = 'WFO') AS wfo_id,
      (SELECT group_concat(DISTINCT external_id) FROM external_ids WHERE taxon_id = t.taxon_id AND source_db = 'GBIF') AS gbif_id,
      (SELECT group_concat(DISTINCT external_id) FROM external_ids WHERE taxon_id = t.taxon_id AND source_db = 'NCBI') AS ncbi_taxid,
      (SELECT group_concat(DISTINCT external_id) FROM external_ids WHERE taxon_id = t.taxon_id AND source_db = 'IPNI') AS ipni_id,
      (SELECT group_concat(DISTINCT external_id) FROM external_ids WHERE taxon_id = t.taxon_id AND source_db = 'POWO') AS powo_id,
      (SELECT group_concat(DISTINCT trait_value) FROM trait_assertions WHERE taxon_id = t.taxon_id AND trait_name = 'lifeform') AS lifeform,
      (SELECT group_concat(DISTINCT trait_value) FROM trait_assertions WHERE taxon_id = t.taxon_id AND trait_name = 'climate') AS climate
    FROM accepted_species_zh t
    WHERE t.taxon_id = ?
    LIMIT 1
  `).bind(taxonId).first();
  if (!row) return null;
  const plant = mapListRow(row, env);
  const [ids, traits, synonyms] = await Promise.all([
    db.prepare('SELECT source_db, external_id, match_type FROM external_ids WHERE taxon_id = ? ORDER BY source_db').bind(taxonId).all(),
    db.prepare('SELECT trait_name, trait_value, raw_value, source_db, confidence_score FROM trait_assertions WHERE taxon_id = ? ORDER BY trait_name').bind(taxonId).all(),
    db.prepare('SELECT synonym_taxon_id, synonym_name, synonym_canonical_name FROM synonym_to_accepted WHERE accepted_taxon_id = ? LIMIT 80').bind(taxonId).all(),
  ]);
  return {
    ...plant,
    externalIds: ids.results ?? [],
    traits: traits.results ?? [],
    synonyms: synonyms.results ?? [],
  };
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders });
    if (path === '/api/health') return json({ ok: true, hasDb: Boolean(env.DB) });
    if (!path.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : error('Not found', 404);
    }

    if (path === '/api/enrichment/preview') return handleWikiPreview(request, env);
    if (path === '/api/enrichment/import') return handleWikiImport(request, env);

    const db = requireDb(env);
    if (path === '/api/summary') return json(await getSummary(db));
    if (path === '/api/families') return json({ items: await getFamilies(db) });
    if (path === '/api/plants') return json(await listPlants(db, readPlantParams(url), env));

    const match = path.match(/^\/api\/plants\/([^/]+)$/);
    if (match) {
      const plant = await getPlant(db, decodeURIComponent(match[1]), env);
      return plant ? json({ item: plant }) : error('Plant not found', 404);
    }

    return error('Not found', 404);
  } catch (caught) {
    if (caught instanceof Response) return caught;
    if (isD1DailyLimitError(caught)) {
      return codedError(
        'D1_DAILY_READ_LIMIT',
        'Cloudflare D1 今日免费读取额度已用完，请在 UTC 午夜重置后再试，或升级 Cloudflare 计划。',
        503,
      );
    }
    console.error(caught);
    return error('Internal error', 500);
  }
}

export default {
  fetch: handleRequest,
};
