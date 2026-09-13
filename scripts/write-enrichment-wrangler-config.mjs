import { readFileSync, writeFileSync } from 'node:fs';

const [, , d1ListPath = '.wrangler-d1-list.json', outputPath = 'wrangler.enrichment.generated.jsonc'] = process.argv;
const MAIN_DB_NAME = 'flora-atlas';
const CONTENT_DB_NAME = 'plants-content-01';

function readDatabases(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.result)) return raw.result;
  if (Array.isArray(raw.databases)) return raw.databases;
  throw new Error(`Cannot find D1 database list in ${path}`);
}

function databaseId(databases, name, envName) {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  const found = databases.find(db => db.name === name || db.database_name === name);
  const id = found?.uuid || found?.id || found?.database_id;
  if (!id) throw new Error(`Cannot find D1 database id for ${name}`);
  return id;
}

const databases = readDatabases(d1ListPath);
const mainDbId = databaseId(databases, MAIN_DB_NAME, 'MAIN_D1_DATABASE_ID');
const contentDbId = databaseId(databases, CONTENT_DB_NAME, 'CONTENT_D1_DATABASE_ID');

const config = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: 'flora-atlas-enrichment',
  main: 'worker/wiki-batch.js',
  compatibility_date: '2026-09-12',
  vars: {
    WIKIMEDIA_CONTACT: 'https://flora-atlas-green.simcardqrm4.chatgpt.site',
    WIKI_BATCH_SIZE: '1',
    WIKI_AUTO_SEED_TARGETS: 'true',
    WIKI_SEED_BATCH_SIZE: '20',
  },
  d1_databases: [
    {
      binding: 'DB',
      database_name: MAIN_DB_NAME,
      database_id: mainDbId,
      migrations_dir: 'migrations/main',
    },
    {
      binding: 'CONTENT_DB',
      database_name: CONTENT_DB_NAME,
      database_id: contentDbId,
      migrations_dir: 'migrations/content',
    },
  ],
  triggers: {
    crons: ['17 */6 * * *'],
  },
};

writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
