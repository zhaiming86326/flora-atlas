# 草木集 / Flora Atlas

A privately deployed, responsive Chinese plant encyclopedia prototype with 12 curated plants, 9 families and 3 browsing groups.

## Run

```bash
npm start
```

Open <http://localhost:4173>. This is a static site: no package installation or cloud database is needed for normal use. `npm run build` validates the checked-in deployable files. All plant photos and subset fonts are served locally.

## Implemented

Chinese/scientific/alias/synonym search with Unicode normalization; group/family/genus/use intersections; sorting; pagination; grid/list views; URL state; directly addressable plant details; source/license tabs; attribution directory; JSON download; mobile filtering; accessible native dialog with Escape and keyboard tabs.

Desktop reading styles are in `public/desktop.css`; section navigation and its active underline are managed by `public/navigation.js`. Desktop type is enlarged from 1101px upward, including a 1920 × 1080 layout.

`worker/index.js` is the first Cloudflare Worker API boundary for the D1 version. It exposes `GET /api/summary`, `GET /api/families`, `GET /api/plants`, and `GET /api/plants/:taxon_id` against a `DB` D1 binding. The page now loads in three stages: summary and all family options first, paged `taxa` rows when the catalog enters view, and one plant detail only after the user opens it.

## Data and sources

`public/data.json` holds structured specimen-like reference records, never invented WFO or WCVP identifiers. `public/media.json` holds individual image creators, original URLs, licenses and modification notices. The build splits them into `summary.json`, `plant-list.json`, and `plant-details/*.json` so local fallback follows the same staged loading shape. In D1, species live in `taxa`; family/genus display names come from `higher_taxa` by `family_taxon_id` and `genus_taxon_id`.

Fonts are local subsets of Noto CJK, renamed Flora Serif / Flora Sans. They retain SIL Open Font License 1.1; see `public/fonts/OFL.txt`. Original fonts: <https://github.com/notofonts/noto-cjk>. Subsetting happened locally.

The prototype references standard botanical facts and is not a field identification or medical tool. Source records explicitly say `demo-reference` and `demo-curated`; full-list ingestion and expert review have not happened.

## Full-data path

- `public/architecture.md`: schema design, API boundaries, import mapping and limitations.
- `public/schema.sql`: PostgreSQL target schema; not applied to a database.
- `scripts/import-taxonomy.py`: offline streaming normalizer for extracted WFO Darwin Core and WCVP tables. Requires explicit release, source and licensing metadata; outputs local staging JSONL plus a validation report. Not a ColDP or arbitrary ZIP parser.

## Verification

```bash
npm test
python tests/importer_test.py
```

Browser regression: install Playwright in your development environment, set `FLORA_QA_CHROMIUM` to a Chromium binary, then run `node tests/browser.spec.cjs`. It serves the site inside its own process and tests desktop and mobile behavior. Screenshots/results are written beside the checkout under `qa/`. The default binary path is specific to the original build environment; set the variable on other computers.

## Deployment

The existing `.openai/hosting.json` binds this checkout to its Sites project. The source assets are `public/`; `npm run build` copies the validated assets to deployable `dist/`; production access is owner-only. Do not create another site or change its visibility to public without authorization.

### Cloudflare GitHub deployment

This repository can also deploy the Worker API plus static `dist/` assets directly to Cloudflare with Wrangler. Pushes to `main` run `.github/workflows/deploy-cloudflare.yml`, which:

1. builds deployable static assets with `npm run build:deploy`;
2. applies D1 migrations for `flora-atlas` from `migrations/main`;
3. applies the idempotent content schema SQL for `plants-content-01`;
4. deploys `worker/index.js` and `dist/` through `wrangler.jsonc`.

In GitHub, add repository secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

The API token needs permission to edit Workers and D1 for this account. `wrangler.jsonc` is production-oriented and only binds the main read API database. It does not enable the local Wikimedia import endpoints. `wrangler.preview.jsonc` remains the local-only config for VPN/proxy-assisted Wikimedia preview/import testing.

### D1 schema and data

Schema lives in committed migrations:

- `migrations/main/0001_catalog_schema.sql`: the main catalogue tables, indexes and views.
- `migrations/content/0001_wikipedia_sources.sql`: reviewed Wikimedia source snapshots.

Bulk catalogue data is intentionally separate from migrations. The generated `wcvp-backbone-import.sql` is about 388 MB, which is too large for normal GitHub commits and should not run on every code push. Import it once from a local machine with Wrangler, or split smaller SQL files under `db/import/` and run the manual `Import D1 SQL` GitHub workflow.

Local one-time import example:

```powershell
npx wrangler d1 migrations apply flora-atlas --remote
npx wrangler d1 execute flora-atlas --remote --file ".\wcvp-backbone-import.sql"
```

After the initial data load, ordinary GitHub pushes update code, assets and schema migrations automatically.
