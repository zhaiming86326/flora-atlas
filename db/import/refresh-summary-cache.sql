-- Refresh small summary tables after a catalogue import.
-- Run after D1 daily read quota resets:
-- npx wrangler d1 execute flora-atlas --remote --file db/import/refresh-summary-cache.sql

CREATE TABLE IF NOT EXISTS catalog_summary_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  plants INTEGER NOT NULL,
  families INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_summary_families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  zh TEXT NOT NULL,
  count INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS catalog_summary_lifeforms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  count INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);

DELETE FROM catalog_summary_stats;
DELETE FROM catalog_summary_families;
DELETE FROM catalog_summary_lifeforms;

INSERT INTO catalog_summary_stats (id, plants, families, refreshed_at)
SELECT
  1,
  COUNT(*) AS plants,
  COUNT(DISTINCT family) AS families,
  datetime('now') AS refreshed_at
FROM accepted_species_zh;

INSERT INTO catalog_summary_families (id, name, zh, count, sort_order)
SELECT
  t.family AS id,
  t.family AS name,
  coalesce(max(t.chinese_family), t.family) AS zh,
  COUNT(*) AS count,
  row_number() OVER (ORDER BY coalesce(max(t.chinese_family), t.family) COLLATE NOCASE ASC, t.family COLLATE NOCASE ASC) AS sort_order
FROM accepted_species_zh t
WHERE t.family IS NOT NULL
GROUP BY t.family;

INSERT INTO catalog_summary_lifeforms (id, name, count, sort_order)
SELECT 'tree', '乔木', COUNT(DISTINCT ta.taxon_id), 1
FROM trait_assertions ta JOIN accepted_species_zh t ON t.taxon_id = ta.taxon_id
WHERE ta.trait_name = 'lifeform' AND lower(ta.trait_value) LIKE '%tree%'
UNION ALL
SELECT 'shrub', '灌木', COUNT(DISTINCT ta.taxon_id), 2
FROM trait_assertions ta JOIN accepted_species_zh t ON t.taxon_id = ta.taxon_id
WHERE ta.trait_name = 'lifeform' AND lower(ta.trait_value) LIKE '%shrub%'
UNION ALL
SELECT 'herb', '草本', COUNT(DISTINCT ta.taxon_id), 3
FROM trait_assertions ta JOIN accepted_species_zh t ON t.taxon_id = ta.taxon_id
WHERE ta.trait_name = 'lifeform' AND (
  lower(ta.trait_value) LIKE '%herb%' OR lower(ta.trait_value) LIKE '%annual%' OR
  lower(ta.trait_value) LIKE '%biennial%' OR lower(ta.trait_value) LIKE '%perennial%' OR
  lower(ta.trait_value) LIKE '%geophyte%' OR lower(ta.trait_value) LIKE '%helophyte%'
)
UNION ALL
SELECT 'climber', '藤本', COUNT(DISTINCT ta.taxon_id), 4
FROM trait_assertions ta JOIN accepted_species_zh t ON t.taxon_id = ta.taxon_id
WHERE ta.trait_name = 'lifeform' AND (
  lower(ta.trait_value) LIKE '%climber%' OR lower(ta.trait_value) LIKE '%liana%' OR lower(ta.trait_value) LIKE '%vine%'
)
UNION ALL
SELECT 'wetland', '水生/湿生植物', COUNT(DISTINCT ta.taxon_id), 5
FROM trait_assertions ta JOIN accepted_species_zh t ON t.taxon_id = ta.taxon_id
WHERE ta.trait_name = 'lifeform' AND (
  lower(ta.trait_value) LIKE '%aquatic%' OR lower(ta.trait_value) LIKE '%helophyte%' OR lower(ta.trait_value) LIKE '%hydrophyte%'
)
UNION ALL
SELECT 'epiphyte', '附生植物', COUNT(DISTINCT ta.taxon_id), 6
FROM trait_assertions ta JOIN accepted_species_zh t ON t.taxon_id = ta.taxon_id
WHERE ta.trait_name = 'lifeform' AND lower(ta.trait_value) LIKE '%epiphyte%'
UNION ALL
SELECT 'annual', '一年生植物', COUNT(DISTINCT ta.taxon_id), 7
FROM trait_assertions ta JOIN accepted_species_zh t ON t.taxon_id = ta.taxon_id
WHERE ta.trait_name = 'lifeform' AND lower(ta.trait_value) LIKE '%annual%'
UNION ALL
SELECT 'perennial', '多年生植物', COUNT(DISTINCT ta.taxon_id), 8
FROM trait_assertions ta JOIN accepted_species_zh t ON t.taxon_id = ta.taxon_id
WHERE ta.trait_name = 'lifeform' AND lower(ta.trait_value) LIKE '%perennial%';
