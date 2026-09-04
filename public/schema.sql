-- PostgreSQL 16+ target schema. Design artifact only; not run against a database.
CREATE TABLE sources (
  source_id text PRIMARY KEY,
  title text NOT NULL,
  homepage_url text NOT NULL
);
CREATE TABLE licenses (
  license_id text PRIMARY KEY,
  title text NOT NULL,
  license_url text NOT NULL
);
CREATE TABLE dataset_releases (
  release_id uuid PRIMARY KEY,
  source_id text NOT NULL REFERENCES sources,
  version text NOT NULL,
  download_url text NOT NULL,
  license_id text NOT NULL REFERENCES licenses,
  retrieved_at timestamptz NOT NULL,
  sha256 char(64) NOT NULL,
  UNIQUE (source_id, version)
);
-- A name is not a cross-provider taxon concept. Source snapshots stay separate.
CREATE TABLE source_records (
  record_id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES dataset_releases,
  external_id text NOT NULL,
  scientific_name text NOT NULL,
  authorship text,
  taxon_rank text,
  taxonomic_status text,
  accepted_external_id text,
  parent_external_id text,
  family_name text,
  genus_name text,
  ipni_id text,
  original_row jsonb NOT NULL,
  UNIQUE (release_id, external_id),
  FOREIGN KEY (release_id, accepted_external_id)
    REFERENCES source_records (release_id, external_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (release_id, parent_external_id)
    REFERENCES source_records (release_id, external_id) DEFERRABLE INITIALLY DEFERRED
);
-- Load into staging first: dangling parents/accepted names need review before promotion.
CREATE TABLE taxa (
  taxon_id uuid PRIMARY KEY,
  preferred_record_id uuid REFERENCES source_records,
  scientific_name text NOT NULL,
  authorship text,
  taxon_rank text NOT NULL,
  parent_taxon_id uuid REFERENCES taxa DEFERRABLE INITIALLY DEFERRED,
  accepted_taxon_id uuid REFERENCES taxa DEFERRABLE INITIALLY DEFERRED,
  family_taxon_id uuid REFERENCES taxa DEFERRABLE INITIALLY DEFERRED,
  genus_taxon_id uuid REFERENCES taxa DEFERRABLE INITIALLY DEFERRED,
  group_code text,
  review_status text NOT NULL DEFAULT 'pending',
  CHECK (parent_taxon_id IS DISTINCT FROM taxon_id)
);
CREATE TABLE taxon_source_mappings (
  taxon_id uuid NOT NULL REFERENCES taxa,
  record_id uuid NOT NULL REFERENCES source_records,
  match_method text NOT NULL,
  reviewed_at timestamptz,
  PRIMARY KEY (taxon_id, record_id),
  UNIQUE (record_id)
);
CREATE TABLE vernacular_names (
  name_id uuid PRIMARY KEY,
  taxon_id uuid NOT NULL REFERENCES taxa,
  name text NOT NULL,
  language_code text NOT NULL,
  region_code text,
  is_preferred boolean NOT NULL DEFAULT false,
  source_id text NOT NULL REFERENCES sources,
  source_url text NOT NULL,
  license_id text NOT NULL REFERENCES licenses,
  retrieved_at timestamptz NOT NULL
);
CREATE TABLE use_assertions (
  assertion_id uuid PRIMARY KEY,
  taxon_id uuid NOT NULL REFERENCES taxa,
  category text NOT NULL,
  plant_part text,
  summary text NOT NULL,
  source_id text NOT NULL REFERENCES sources,
  reference_url text NOT NULL,
  license_id text NOT NULL REFERENCES licenses,
  retrieved_at timestamptz NOT NULL,
  review_status text NOT NULL DEFAULT 'pending'
);
CREATE TABLE media_assets (
  media_id uuid PRIMARY KEY,
  taxon_id uuid NOT NULL REFERENCES taxa,
  object_key text NOT NULL,
  creator text NOT NULL,
  source_url text NOT NULL,
  original_url text NOT NULL,
  license_id text NOT NULL REFERENCES licenses,
  modifications text NOT NULL,
  caption text,
  retrieved_at timestamptz NOT NULL
);
-- Normalized NFKC/lowercase name variants are maintained by the import worker.
CREATE TABLE search_names (
  taxon_id uuid NOT NULL REFERENCES taxa,
  normalized_name text NOT NULL,
  name_kind text NOT NULL,
  source_record_id uuid REFERENCES source_records,
  PRIMARY KEY (taxon_id, normalized_name, name_kind)
);
CREATE INDEX taxa_parent_idx ON taxa(parent_taxon_id);
CREATE INDEX taxa_facets_idx ON taxa(group_code, family_taxon_id, genus_taxon_id, taxon_id);
CREATE INDEX uses_category_idx ON use_assertions(category, taxon_id);
CREATE INDEX source_name_idx ON source_records(scientific_name);
CREATE INDEX search_names_exact_idx ON search_names(normalized_name, taxon_id);
-- Optional substring index when the managed database supports pg_trgm:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX search_names_trgm_idx ON search_names USING gin (normalized_name gin_trgm_ops);
