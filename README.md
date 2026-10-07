# URI Faculty Senate Assistant — prototype

A conversational assistant grounded in public URI Faculty Senate resources. GitHub Pages hosts the frontend and immutable source files. Cloudflare Workers retrieves relevant passages and calls Claude Opus 5.5 through the URI AI gateway. The gateway credential stays encrypted on Cloudflare and never appears in browser code or GitHub.

[Live assistant](https://csckhanna.github.io/faculty-senate-assistant/)

## Source coverage

The initial October 6, 2026 snapshot has **1,321 sources and 28,573 passages**:

- The full reachable public Notion toolkit: 24 pages, 272 database entries, and all 59 embedded images/files. Synced content, collapsed sections, and database rows are included.
- All 48 publicly published Faculty Senate pages/posts were audited, including pages missing from menus. The website crawl indexed 921 pages and linked documents, including University Manual sections, reports, minutes, legislation, and spreadsheets.
- 33 instructional website images are available as OCR text, including the image-only Senate FAQ. PDF extraction includes recovered OCR from 780 pages in 211 documents. Image text has whitespace normalization; original letters and numbers are preserved.
- Nine readable proposal trackers: the current 2026–2027 tracker plus eight archives, with **71 tabs and 5,697 nonempty rows**. Program/course identities, column labels, academic years, and recorded statuses stay together.

**The 2019–2020 tracker requires access (HTTP 401) and is not indexed.** The initial October 6 audit recorded 595 unavailable/unreadable linked resources, including broken legacy links, refused DigitalCommons downloads, restricted documents, malformed files, and a video without an imported transcript. These are link-level gaps; some historical material is also available through another indexed copy. See the live app’s source coverage dialog and `data/coverage.json` for the current inventory and gaps.

Public source snapshots refresh daily; meeting and agenda questions also check the Senate website directly. This is not live Kuali access. Historical proposals, reports, and blank approval fields do not establish current policy or completed approvals. OCR cannot reliably establish diagram relationships, chart values, handwriting, checkmarks, or signatures; verify the original. Some published pages are explicitly under construction.

## Retrieval and chat

`prepare_corpus.mjs` builds an immutable corpus revision: compact lexical postings, passage metadata, and text shards. The Worker searches the compact index and fetches only the selected source text before calling Claude Opus. The full corpus remains available without embedding tens of megabytes in the Worker or sending every document in each prompt. A single public release pointer selects matching immutable corpus and bill indexes. The backend checks the release on requests, with a five-minute cache, and retains the last readable generation when a publication or download fails. A new source refresh does not need a Worker redeployment.

Answers include validated source citations and retain context for short replies while keeping independent questions separate. Wrapped JSON is extracted before display; malformed transport fields cannot appear as an answer. The interface renders paragraphs, steps, emphasis, and clickable citation markers safely, with source notes grouped in expandable references. Procedural retrieval includes course classifications, start instructions, and submission steps. Named approval lookups prioritize matching tracker rows, including common AI wording. Year-wide program status questions inspect every recorded-status row in the primary B/C tracker tabs and distinguish pending or tabled proposals from denials. Tracker coverage is supplied separately so the assistant can explicitly identify the unavailable 2019–2020 archive rather than substitute another year.

The app offers a reviewed email draft to Genviéve Spitale (`genvieve.spitale@uri.edu`) with the original question for the active topic preserved exactly. **Nothing sends emails automatically.** A single conversation panel keeps the composer available for follow-ups.

## Limits and hosting

The Worker uses the existing D1 usage database, `faculty-senate-pilot-usage`. The pilot allows 100 requests per UTC day across all users and eight requests per minute per network. These limits remain in place; they do not guarantee a fixed dollar spend. Claude Opus model: `its_direct/pt3-claude-opus-5.5-1m-us`. Requests use the model’s default temperature and the existing structured JSON response format. PDF answers have a 55-second gateway limit; other answers retain 45 seconds. Live source checks plus the PDF limit fit inside the browser’s 75-second request limit. Failure diagnostics record only the processing stage and a bounded error category or HTTP status, never questions, credentials, or response content.

The Worker permits the configured GitHub origin. Credentials are used only in the gateway Authorization header. Indexed source downloads come from the public GitHub corpus; live meeting and agenda downloads go directly to public URI and Google Docs/Drive pages. These public source requests contain no credentials or conversation text. Generated links and source IDs are checked against retrieved evidence.

## Automatic source updates

The **Refresh sources and publish assistant** GitHub Actions workflow runs daily at **10:17 UTC** (6:17 a.m. Eastern during daylight saving time, 5:17 a.m. during standard time). GitHub may delay scheduled runs. It can also be started from Actions with **Run workflow**. The default manual run refreshes the public toolkit, Senate pages, linked documents, and every readable tracker tab before publishing. A code push publishes the tested current source generation without recrawling.

Refreshes use public sources and the workflow's temporary repository token; they do not need the AI key or a Cloudflare deployment credential. Extraction runs in a staging directory. Every passage, source identity, corpus/bill generation, text shard, and posting identifier is validated before publication. Failed downloads retain their last readable text and original extraction date, with a visible source qualification. Restricted documents remain unavailable. Changed or new toolkit media are declared as gaps until their transcription is reviewed; existing reviewed image text retains its actual extraction date.

Cold refreshes seed 2,186 OCR page results from public Senate PDFs using the compact `data/ocr-bootstrap.json` file. This includes 1,416 additional pages extracted on October 7, 2026; the original 770 results are preserved. Source hashes, page associations, and cache results were verified before inclusion. A result is reused only when the freshly downloaded PDF has the exact same SHA-256 content hash and page number; changed documents receive new extraction. Existing cache results are preserved. Completed results with no detected text are cached too; they do not prove a page is blank. The seed contains public text, not PDF downloads or private metadata.

A single `data/source-release.json` pointer publishes corpus and bill indexes together. The Worker rechecks it on requests after its five-minute cache expires; it validates the immutable assets before adopting a generation. A temporary pointer or text download failure falls back to the previous readable generation and marks the answer. Four recent generations plus the original bootstrap remain available. Opening source coverage loads a matching inventory and coverage report for one snapshot, with each source’s text collection date, qualifications, and unresolved links. An incomplete publication provides a retry instead of combining different snapshots; updating the inventory preserves the conversation and draft.

Questions about the next or recent Faculty Senate meeting read the current [meeting page](https://web.uri.edu/facsen/meetings/) and its public agenda link for that question, independently of the daily crawl. A scheduled date without an agenda link is reported accurately. The assistant does not replace an upcoming agenda with an older one. Meeting answers show the successful checked time; failed checks preserve the question and offer retry or an unsent staff email draft. Other committee and historical questions use the source corpus.

For a local refresh, install `requirements-refresh.txt` and Poppler, then run `python3 scripts/refresh_sources.py`. `--dry-run` fetches and validates without modifying published source data. `SOURCE_CACHE` chooses an external public download/OCR cache. `npm test` validates application and source invariants; `node scripts/build_pages.mjs` prepares only public files for Pages. Raw downloads, private configuration, and transcripts stay outside the published artifact.

## Validation

The automated regression suite covers complete toolkit registration, published-page coverage, tracker tabs/rows and field labels, exact text hydration, historical program lookup, submission steps, follow-up context, per-answer citation numbering, citation validation, credential handling, and request caps. Real Sonnet evaluation includes a named program record, committee duties, meeting attendance/voting, unavailable tracker access, and prerequisite changes. Tests do not send emails.


## Quality assurance

See [QUALITY.md](QUALITY.md) for the experience and verification contract. Chat starts with the small manifest and health check; source inventory and local search load on demand. Refresh preserves the transcript and draft in tab-scoped session storage, including a retry for interrupted requests. New conversation clears them. Failed requests retry in place without discarding a draft. The AI daily limit remains 100; after the limit, the same interface provides source search. Citation numbers are consolidated per document, and copied answers include the references.

Run `npm test` for factual retrieval, corpus integrity, transport, context, and real SQLite budget tests. `node scripts/build_quality_preview.mjs` creates `quality-preview.html` with simulated replies, no credentials, and no paid AI calls. Browser scenarios use `?scenario=slow`, `error-once`, `invalid`, `daily-limit`, `offline`, `inventory-error`, `long`, or `unsafe`. Publish the generated preview alongside the source data to test the exact interface in Chrome. Its tab storage is separate from the live assistant. Use bounded real Claude Opus evaluations to check answer quality; deterministic fixtures verify interface behavior only.
