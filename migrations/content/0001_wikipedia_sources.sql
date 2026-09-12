PRAGMA foreign_keys = ON;

-- Source metadata. Content is review-only until a later sanitizer/editorial step.
CREATE TABLE IF NOT EXISTS source_documents (
  document_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  language TEXT NOT NULL,
  external_page_id INTEGER NOT NULL,
  wikidata_qid TEXT NOT NULL,
  title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  latest_revision_id INTEGER NOT NULL,
  match_status TEXT NOT NULL CHECK (match_status IN ('matched_unreviewed', 'approved', 'rejected')),
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, language, external_page_id)
);

-- Immutable source snapshots. A new upstream revision becomes a new row.
CREATE TABLE IF NOT EXISTS source_document_versions (
  document_id TEXT NOT NULL,
  revision_id INTEGER NOT NULL,
  source_wikitext TEXT NOT NULL,
  tocdata_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (document_id, revision_id),
  FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE
);

-- taxon_id belongs to DB, so it deliberately has no cross-database foreign key.
CREATE TABLE IF NOT EXISTS taxon_document_links (
  taxon_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('description_source')),
  review_status TEXT NOT NULL CHECK (review_status IN ('review', 'approved', 'rejected')),
  match_evidence_json TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (taxon_id, document_id),
  FOREIGN KEY (document_id) REFERENCES source_documents(document_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS source_documents_qid_idx
  ON source_documents(wikidata_qid, language);

CREATE INDEX IF NOT EXISTS taxon_document_links_document_idx
  ON taxon_document_links(document_id);
