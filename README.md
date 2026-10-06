# Faculty Senate Curriculum Assistant — prototype

A separate, unofficial review prototype for the University of Rhode Island Faculty Senate. Users ask questions in plain language, see original source passages with links, and can open an email draft to Genviéve Spitale with their original question preserved exactly.

## What works

- Local question-based retrieval across a saved public-source index.
- Source citations, snapshot date, development/partial-source notices, and a browsable source inventory.
- No-match fallback to `genvieve.spitale@uri.edu` with subject `Faculty Senate curriculum question`.
- Email opens in the user's mail app; the user reviews and sends it. The prototype does not send messages.
- Responsive, keyboard-accessible UI. No account, API key, upload, query history, or application analytics.

## Important scope

This version returns **source excerpts**, not AI-generated conversational answers. A match does not establish that a passage fully answers the question. A missing match does not establish that guidance is absent.

It uses a snapshot, not a live search of all current resources. `data/coverage.json` records the actual indexed sources, failed/partial imports, and out-of-scope links. The on-screen source list exposes these limitations.

The importer reads public Notion toolkit pages, reachable public Faculty Senate website pages, and directly linked text-readable URI PDFs. Notion's public read API is unofficial and may change. Embedded database rows, images/flowcharts, Google documents/spreadsheets, restricted files, external archives, and scanned PDFs need separate ingestion. Some sources may be old or unfinished; the app does not silently reconcile conflicts or assert a date is current.

## Local preview and checks

```sh
npm start
# http://127.0.0.1:4173
npm test
```

No npm installation is required. The client uses vanilla HTML, CSS, and ES modules. Google Fonts is optional; local system fonts are fallbacks.

## Refreshing the source snapshot

Use Python 3. Install `pypdf` to include text-readable PDFs:

```sh
python3 -m pip install pypdf
python3 scripts/build_index.py
npm test
```

Review `data/coverage.json` before publishing a refresh. Commit the updated data files and push `main` to update GitHub Pages. There is no scheduled refresh in this prototype.

Only extracted public text is published. Raw Notion record maps, permissions, user identifiers, authentication data, and source-fetch logs are not stored in the repository.

## Hosting

The site is static and can run on GitHub Pages. GitHub Pages is configured to publish `main` from the repository root. `.nojekyll` disables Jekyll processing. GitHub operates the hosting service and may log visitor network information; the app itself does not transmit search questions to a server.

## Next step toward the conversational assistant

1. Complete ingestion of the remaining linked documents, database rows, and flowchart content. Agree on source freshness and handling of conflicting guidance.
2. Add a server-side retrieval and language-model endpoint. Keep credentials on the server; do not put an API key in client code or in this repository. GitHub Pages alone cannot run this endpoint.
3. Generate short answers only from retrieved passages, with source links, clarification when necessary, and the existing user-reviewed email fallback when evidence is insufficient. Test real recurring questions with Faculty Senate staff before campus release.

Faculty Senate continues maintaining the toolkit and website. No separate approved-answer bank is required.
