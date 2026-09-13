CREATE TABLE IF NOT EXISTS wikipedia_article_extracts (
  document_id TEXT NOT NULL,
  revision_id INTEGER NOT NULL,
  lead_text TEXT,
  morphology_text TEXT,
  uses_text TEXT,
  cultivation_text TEXT,
  propagation_text TEXT,
  varieties_text TEXT,
  nutrition_text TEXT,
  conservation_status_text TEXT,
  extracted_at TEXT NOT NULL,
  PRIMARY KEY (document_id, revision_id),
  FOREIGN KEY (document_id, revision_id)
    REFERENCES source_document_versions(document_id, revision_id)
    ON DELETE CASCADE
);
