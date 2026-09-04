# Verification — 2026-09-04

Validated 12 plant records, 9 families, 3 groups and 12 locally packaged, individually licensed photos.

Automated checks passed:
- Eight query/domain tests: Chinese names, aliases, scientific-name Unicode normalization, historical synonyms, intersection filters, safe input, pagination limits, sorting.
- Three import-adapter tests: WCVP self-acceptance and synonyms; WFO unresolved parent reporting; duplicate IDs/missing fields rejected.
- Desktop Chromium at 1440 × 1000: initial render, images, Chinese/Latin/alias search, empty state/reset, family/use/genus intersections, URL reload, plant details, source/license tabs, clipboard, pagination, sorting, grid/list toggle, credits, schema description, JSON download, invalid record state.
- Mobile Chromium at 390 × 844: no horizontal overflow, filter drawer, group selection, detail page, provenance tab and close action.
- Narrow mobile at 320 × 740: no horizontal overflow.
- No browser JavaScript runtime errors.

Desktop overview, mobile overview, desktop detail and mobile detail screenshots were visually inspected. Core browsing makes no third-party requests. Photos and locally subset Noto CJK fonts are packaged with the site.

Scope: static curated-data prototype. Full WFO/WCVP data, a database, server-side search and scheduled imports are not connected. The SQL and offline conversion script are foundations for that follow-up work, not deployed backend services.
