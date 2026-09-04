# 草木集 / Flora Atlas

A privately deployed, responsive Chinese plant encyclopedia prototype with 12 curated plants, 9 families and 3 browsing groups.

## Run

```bash
npm start
```

Open http://localhost:4173. This is a static site: no package installation or cloud database is needed for normal use. `npm run build` validates the checked-in deployable files. All plant photos and subset fonts are served locally.

## Implemented

Chinese/scientific/alias/synonym search with Unicode normalization; group/family/genus/use intersections; sorting; pagination; grid/list views; URL state; directly addressable plant details; source/license tabs; attribution directory; JSON download; mobile filtering; accessible native dialog with Escape and keyboard tabs.

## Data and sources

`public/data.json` holds structured specimen-like reference records, never invented WFO or WCVP identifiers. `public/media.json` holds individual image creators, original URLs, licenses and modification notices. Independently authored Chinese summaries are CC0; reference-site prose is not copied or relicensed. Images remain under their own CC BY / CC0 licenses.

Fonts are local subsets of Noto CJK, renamed Flora Serif / Flora Sans. They retain SIL Open Font License 1.1; see `public/assets/OFL.txt`. Original fonts: https://github.com/notofonts/noto-cjk . Subsetting happened locally.

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
