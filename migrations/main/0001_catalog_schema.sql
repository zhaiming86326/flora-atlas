-- Main D1 schema for the WCVP-backed Flora Atlas catalogue.
-- Bulk data is loaded separately; this migration only owns tables, indexes and views.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS taxonomic_backbone (
  taxon_id TEXT PRIMARY KEY,
  wcvp_id TEXT NOT NULL UNIQUE,
  scientific_name TEXT NOT NULL,
  canonical_name TEXT,
  authorship TEXT,
  taxon_rank TEXT,
  taxonomic_status TEXT,
  accepted_taxon_id TEXT,
  parent_taxon_id TEXT,
  family TEXT,
  genus TEXT,
  geographic_area TEXT,
  normalized_accepted_taxon_id TEXT NOT NULL,
  is_accepted INTEGER NOT NULL,
  is_species_or_below INTEGER NOT NULL,
  reviewed TEXT
);

CREATE TABLE IF NOT EXISTS chinese_taxon_names (
  taxon_id TEXT PRIMARY KEY,
  chinese_name TEXT NOT NULL,
  chinese_sort_key TEXT,
  chinese_family TEXT,
  chinese_genus TEXT,
  source_file TEXT NOT NULL,
  match_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accepted_species_zh (
  taxon_id TEXT PRIMARY KEY,
  wcvp_id TEXT NOT NULL UNIQUE,
  scientific_name TEXT NOT NULL,
  canonical_name TEXT,
  authorship TEXT,
  taxon_rank TEXT,
  taxonomic_status TEXT,
  accepted_taxon_id TEXT,
  parent_taxon_id TEXT,
  family TEXT,
  genus TEXT,
  geographic_area TEXT,
  normalized_accepted_taxon_id TEXT NOT NULL,
  is_accepted INTEGER NOT NULL,
  is_species_or_below INTEGER NOT NULL,
  reviewed TEXT,
  chinese_name TEXT NOT NULL,
  chinese_sort_key TEXT,
  chinese_family TEXT,
  chinese_genus TEXT
);

CREATE TABLE IF NOT EXISTS external_ids (
  taxon_id TEXT NOT NULL,
  source_db TEXT NOT NULL,
  external_id TEXT NOT NULL,
  match_type TEXT NOT NULL,
  PRIMARY KEY (source_db, external_id)
);

CREATE TABLE IF NOT EXISTS trait_assertions (
  assertion_id INTEGER PRIMARY KEY AUTOINCREMENT,
  taxon_id TEXT NOT NULL,
  trait_name TEXT NOT NULL,
  trait_value TEXT NOT NULL,
  raw_value TEXT,
  source_db TEXT NOT NULL,
  confidence_score REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS plant_enrichment_targets (
  taxon_id TEXT PRIMARY KEY,
  lookup_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'review', 'done', 'skipped', 'error')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS wcvp_name_idx ON taxonomic_backbone(canonical_name, taxon_rank, family, genus);
CREATE INDEX IF NOT EXISTS wcvp_status_idx ON taxonomic_backbone(taxonomic_status, taxon_rank);
CREATE INDEX IF NOT EXISTS wcvp_accepted_idx ON taxonomic_backbone(normalized_accepted_taxon_id);
CREATE INDEX IF NOT EXISTS wcvp_parent_idx ON taxonomic_backbone(parent_taxon_id);
CREATE INDEX IF NOT EXISTS chinese_taxon_names_name_idx ON chinese_taxon_names(chinese_name);
CREATE INDEX IF NOT EXISTS chinese_taxon_names_sort_idx ON chinese_taxon_names(chinese_sort_key);
CREATE INDEX IF NOT EXISTS accepted_species_zh_name_idx ON accepted_species_zh(canonical_name, family, genus);
CREATE INDEX IF NOT EXISTS accepted_species_zh_family_idx ON accepted_species_zh(family, chinese_family);
CREATE INDEX IF NOT EXISTS accepted_species_zh_sort_idx ON accepted_species_zh(chinese_sort_key, canonical_name);
CREATE INDEX IF NOT EXISTS external_ids_taxon_source_idx ON external_ids(taxon_id, source_db);
CREATE INDEX IF NOT EXISTS external_ids_source_external_idx ON external_ids(source_db, external_id);
CREATE INDEX IF NOT EXISTS traits_taxon_idx ON trait_assertions(taxon_id, trait_name);
CREATE INDEX IF NOT EXISTS plant_enrichment_targets_status_idx ON plant_enrichment_targets(status, taxon_id);

CREATE VIEW IF NOT EXISTS accepted_species AS
SELECT *
FROM taxonomic_backbone
WHERE is_accepted = 1 AND lower(taxon_rank) = 'species';

CREATE VIEW IF NOT EXISTS synonym_to_accepted AS
SELECT
  s.taxon_id AS synonym_taxon_id,
  s.scientific_name AS synonym_name,
  s.canonical_name AS synonym_canonical_name,
  a.taxon_id AS accepted_taxon_id,
  a.scientific_name AS accepted_name,
  a.canonical_name AS accepted_canonical_name,
  a.family,
  a.genus
FROM taxonomic_backbone s
JOIN taxonomic_backbone a ON a.taxon_id = s.normalized_accepted_taxon_id
WHERE s.is_accepted = 0;
