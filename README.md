# URI Faculty Senate Assistant — prototype

A conversational assistant grounded in public URI Faculty Senate resources. GitHub Pages hosts the frontend and immutable source files. Cloudflare Workers retrieves relevant passages and calls Sonnet 5.5 through the URI AI gateway. The gateway credential stays encrypted on Cloudflare and never appears in browser code or GitHub.

[Live assistant](https://csckhanna.github.io/faculty-senate-assistant/)

## Current coverage

The October 6, 2026 snapshot has **1,321 sources and 28,573 passages**:

- The full reachable public Notion toolkit: 24 pages, 272 database entries, and all 59 embedded images/files. Synced content, collapsed sections, and database rows are included.
- All 48 publicly published Faculty Senate pages/posts were audited, including pages missing from menus. The website crawl indexed 921 pages and linked documents, including University Manual sections, reports, minutes, legislation, and spreadsheets.
- 33 instructional website images are available as OCR text, including the image-only Senate FAQ. PDF extraction includes recovered OCR from 780 pages in 211 documents. Image text has whitespace normalization; original letters and numbers are preserved.
- Nine readable proposal trackers: the current 2026–2027 tracker plus eight archives, with **71 tabs and 5,697 nonempty rows**. Program/course identities, column labels, academic years, and recorded statuses stay together.

**The 2019–2020 tracker requires access (HTTP 401) and is not indexed.** The audit records 595 unavailable/unreadable linked resources, including broken legacy links, refused DigitalCommons downloads, restricted documents, malformed files, and a video without an imported transcript. These are link-level gaps; some historical material is also available through another indexed copy. See the live app’s source coverage dialog and `data/coverage.json` for the exact inventory.

This is a dated snapshot, not live Kuali access. Historical proposals, reports, and blank approval fields do not establish current policy or completed approvals. OCR cannot reliably establish diagram relationships, chart values, handwriting, checkmarks, or signatures; verify the original. Some published pages are explicitly under construction.

## Retrieval and chat

`prepare_corpus.mjs` builds an immutable corpus revision: compact lexical postings, passage metadata, and text shards. The Worker searches the compact index and fetches only the selected source text before calling Sonnet. The full corpus remains available without embedding tens of megabytes in the Worker or sending every document in each prompt. Both frontend and backend use the same pinned source revision.

Answers include validated source citations and retain context for short replies while keeping independent questions separate. Wrapped JSON is extracted before display; malformed transport fields cannot appear as an answer. The interface renders paragraphs, steps, emphasis, and clickable citation markers safely, with source notes grouped in expandable references. Procedural retrieval includes course classifications, start instructions, and submission steps. Named approval lookups prioritize matching tracker rows, including common AI wording. Year-wide program status questions inspect every recorded-status row in the primary B/C tracker tabs and distinguish pending or tabled proposals from denials. Tracker coverage is supplied separately so the assistant can explicitly identify the unavailable 2019–2020 archive rather than substitute another year.

The app offers a reviewed email draft to Genviéve Spitale (`genvieve.spitale@uri.edu`) with the original question for the active topic preserved exactly. **Nothing sends emails automatically.** A single conversation panel keeps the composer available for follow-ups.

## Limits and hosting

The Worker uses the existing D1 usage database, `faculty-senate-pilot-usage`. The pilot allows 100 requests per UTC day across all users and eight requests per minute per network. These limits remain in place; they do not guarantee a fixed dollar spend. Sonnet model: `its_direct/pt3-claude-sonnet-5.5-1m-us`. The gateway does not support nondefault temperature for this model, so that parameter is omitted.

The Worker permits the configured GitHub origin. Credentials are used only in the gateway Authorization header. Source downloads go to the public GitHub corpus without credentials or conversation text. Generated links and source IDs are checked against retrieved evidence.

## Refreshing sources

Keep raw downloads and private configuration outside the repository. Python requires `pypdf` and `openpyxl`; image recovery optionally uses `rapidocr-onnxruntime` and `wordninja`, plus Poppler `pdftoppm`.

1. Run `scripts/crawl_toolkit.py` / `scripts/build_index.py` for a fresh public toolkit import. Changed toolkit images/files are explicitly reported for review; their existing transcriptions are reused only when the attachment reference matches.
2. Run `scripts/crawl_senate.py` to refresh the published website inventory and linked public documents. It follows Google redirects, preserves required query parameters, and exports all spreadsheet tabs. `SENATE_REFRESH=0` reuses an existing download cache; normal crawl runs refresh downloads. `SENATE_CACHE` selects an external cache directory.
3. Run `scripts/crawl_senate_media.py` for instructional website image OCR. Decorative photos/headshots are excluded. Video transcript gaps remain explicit.
4. Run `scripts/recover_senate_cached.py` to attach already recovered OCR and attempt image-only documents with a bounded extraction time. Existing readable text is preserved when image recovery fails.
5. Run `scripts/merge_senate.py`, then `npm run prepare:corpus` and `npm test`.
6. Publish the static corpus on GitHub Pages, bundle the backend with `npm run bundle:backend`, deploy it to the existing Worker, and verify live answers and matching snapshot counts.

Keep previously deployed immutable corpus revisions until no deployed Worker references them. Do not import account-only Kuali contents or publish restricted material without authorization. Public-link access failures require an accessible public copy or staff assistance.

## Validation

The automated regression suite cover complete toolkit registration, published-page coverage, tracker tabs/rows and field labels, exact text hydration, historical program lookup, submission steps, follow-up context, per-answer citation numbering, citation validation, credential handling, and request caps. Real Sonnet evaluation includes a named program record, committee duties, meeting attendance/voting, unavailable tracker access, and prerequisite changes. Tests do not send emails.


## Quality assurance

See [QUALITY.md](QUALITY.md) for the experience and verification contract. Chat starts with the small manifest and health check; source inventory and local search load on demand. Refresh preserves the transcript and draft in tab-scoped session storage, including a retry for interrupted requests. New conversation clears them. Failed requests retry in place without discarding a draft. The AI daily limit remains 100; after the limit, the same interface provides source search. Citation numbers are consolidated per document, and copied answers include the references.

Run `npm test` for factual retrieval, corpus integrity, transport, context, and real SQLite budget tests. `node scripts/build_quality_preview.mjs` creates `quality-preview.html` with simulated replies, no credentials, and no paid AI calls. Browser scenarios use `?scenario=slow`, `error-once`, `invalid`, `daily-limit`, `offline`, `inventory-error`, `long`, or `unsafe`. Publish the generated preview alongside the source data to test the exact interface in Chrome. Its tab storage is separate from the live assistant. Use bounded real Sonnet evaluations to check answer quality; deterministic fixtures verify interface behavior only.
