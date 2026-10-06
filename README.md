# Faculty Senate Curriculum Assistant — conversational pilot

An unofficial review prototype for URI Faculty Senate. The frontend is hosted on GitHub Pages; the conversational backend runs on Cloudflare Workers with an encrypted URI AI gateway credential. The conversational frontend is published on GitHub Pages after successful hosted backend verification.

Backend: `https://faculty-senate-assistant-api.april-khanna.workers.dev`. D1 usage database: `faculty-senate-pilot-usage`.

## Behavior

- Answers in conversational language using retrieved toolkit and Faculty Senate passages, with original source links.
- Asks clarifying questions and retains recent follow-up context as the conversation continues.
- Offers a user-reviewed email draft to Genviéve Spitale (`genvieve.spitale@uri.edu`) with the first question preserved exactly; nothing is sent automatically.
- Falls back to local source search when the AI connection is unavailable at page load.
- Shows source inventory, snapshot date, and partial or unfinished source notices.

## Source coverage

The snapshot contains 57 sources, including 24 toolkit pages. It is not a live search of every current resource. `data/coverage.json` records partial imports, failed links, and linked resources outside the index; the interface exposes those limitations.

The importer reads public Notion pages, reachable public Faculty Senate website pages, and directly linked text-readable URI PDFs. Notion's public read API is unofficial and may change. Embedded database rows, images and flowcharts, Google documents and spreadsheets, restricted files, external archives, and scanned PDFs need separate ingestion. Some sources are old or unfinished. The assistant is instructed to preserve uncertainty and cite its evidence, but staff review is still needed before campus release.

No separate approved-answer bank is required. Faculty Senate continues maintaining its toolkit and website.

## Local preview

```sh
npm install
npm start
# http://127.0.0.1:4173
npm test
```

The static preview requires only Node.js. Installing dependencies adds the Cloudflare deployment CLI. To test real AI locally, supply `URI_ENV_FILE` pointing to a private file outside the repository containing `URI_API_KEY=...`. Never commit this file. `PORT` optionally changes the local port.

## Refreshing the source snapshot

```sh
python3 -m pip install pypdf
python3 scripts/build_index.py
npm test
```

Review coverage and failed imports before publishing. Only extracted public text is committed; raw Notion records, permissions, user identifiers, authentication data, and fetch logs are excluded. There is no scheduled refresh.

## Privacy and hosting

Conversation history stays in browser memory for the visit. Connected requests send that history and retrieved public evidence through the backend to URI's AI gateway. This app stores usage counters, not conversation content, on the backend. Cloudflare, GitHub, and the gateway operate under their own service policies. Users should avoid entering private student, personnel, or other sensitive information into this public pilot.

GitHub Pages publishes `main` from the repository root with `.nojekyll`. GitHub Pages hosts the frontend; it cannot execute the AI backend. API credentials belong exclusively in the backend's encrypted secret configuration. `config.js` contains only the public backend URL.

## Conversational backend (version 0.2)

`backend/chat.js` retrieves up to sixteen indexed passages, sends those passages and the last conversation turns to URI's OpenAI-compatible gateway, and validates the structured response. It asks clarifying questions, interprets follow-ups, and returns only links from the source registry. Citation validation does not establish factual correctness: staff review of real answers remains necessary. The snapshot's existing coverage limitations still apply.

`backend/worker.js` runs on Cloudflare Workers. An atomic D1 database transaction reserves requests before AI calls, with a default hard limit of 100 calls per UTC day across the whole pilot and eight calls per UTC minute per network address. Shared campus network addresses may share the minute limit. Failed API calls also consume a daily slot. Only daily usage counters and temporary hashed network-address counters are persisted; conversation messages are not stored by this app. Old counters are cleaned on the next request (network counters after two minute buckets, daily counters after the day changes); idle counters can remain until another request, and provider backups may retain prior data. Cloudflare and the URI gateway may process and retain data under their own service policies. CORS limits browser origins but is not authentication. This is a bounded public pilot, not an authenticated campus service.

Default model: `its_direct/pt2-claude-haiku-4.5-us`. Maximum output: 1,800 tokens per call; maximum conversation request: 22,000 characters plus bounded retrieved evidence. Limits bound request volume, not an exact dollar amount.

### Deployment

1. Deploy with `npx wrangler deploy` after signing in, or paste the bundled Worker into Cloudflare’s code editor. The GitHub app is installed for this repository, but Cloudflare’s Git account connection did not complete; automated backend builds are not configured. The included `wrangler.jsonc` declares the D1 database. Create tables with `backend/schema.sql` in the D1 console, then bind it as `PILOT_DB`.
2. Add `URI_API_KEY` as an encrypted Worker secret with `npx wrangler secret put URI_API_KEY`. Enter the credential directly in the secret prompt. Never put it in GitHub or `config.js`.
3. Check `/health` and test a conversation from the GitHub website origin. URI gateway access from Cloudflare still needs verification; local API access does not prove remote access.
4. Set `CHAT_API_URL` in `config.js` to the Worker URL, without a trailing slash. Push the frontend only once the backend is verified.

The frontend falls back to source search if the backend is absent or unavailable. The frontend was upgraded after the hosted backend passed a real conversation test. Session history is in browser memory only. The request includes a rolling recent context within the API limits, so the visible conversation can continue past eight exchanges. The first question is preserved exactly in the email fallback.

### Moving to ITS

The conversation logic is provider-independent JavaScript using standard HTTP requests. ITS can host `backend/chat.js` behind a server-side `/chat` endpoint using the same response shape. Replace the Cloudflare D1 request limiter with ITS's equivalent, provision the API key on the ITS host, update allowed origins, and change `CHAT_API_URL`. Do not assume gateway credentials or a personal budget automatically transfer to a shared service.

### Verification

Twenty-four automated checks cover retrieval, follow-up context, message limits, citation rejection, email fidelity, and credential exclusion. A live two-turn test against the URI gateway on October 6, 2026 produced a clarification followed by a course-modification answer with toolkit citations. Cloudflare backend, D1 storage, and the encrypted production credential are deployed. A hosted two-turn test also passed on October 6, 2026.


### Answer reliability fix — October 6, 2026

Search now recognizes conversational wording such as “class that I teach” and retrieves procedure-start sections alongside matched fields. Follow-up retrieval uses both the original topic and the assistant’s last question without treating previous answers as factual sources. The gateway is explicitly asked for JSON; cited plain text and JSON with a missing citation list are accepted only after validating every citation against supplied evidence. Capability questions are handled without a paid request. Unknown citations, unsupported plain text, and invented URLs remain rejected.

The regression suite includes the actual failed user questions, prerequisite follow-ups, temporary-to-permanent navigation, and both gateway response formats. Real gateway tests cover course changes, Kuali/login, capability questions, permanent-course conversion, tracking, cross-listing, date ambiguity, and an unrelated request. Some embedded source content still needs separate ingestion. No emails are sent by the app or its tests.


### Helpful fallback update — October 6, 2026

The conversational retriever uses broader ranking when an exact keyword search has no match. It still supplies original evidence and preserves normal strict search for the standalone excerpt UI. Questions with partial evidence should receive the supported part, a specific limitation, and an appropriate next step. Unknown topics receive a routing question rather than an immediate staff referral.

Gateway and model-format failures return clearly labeled original source excerpts. Backend infrastructure failures also fall back to excerpts. Rate limits stay enforced; the browser can show related local excerpts while a request is blocked. Long conversations keep a bounded recent API context while preserving the full visible transcript and exact first question for the optional email draft. Clarifications no longer display a staff-email option after every turn.

Twenty-four automated tests cover these behaviors, including simulated network/invalid-output failures and a long transcript. Real gateway tests also included broad course redesign, prerequisite changes combined with an approval-guarantee question, sent-back proposals, and syllabus-upload wording. This improves usefulness without establishing complete source coverage or guaranteeing AI accuracy.
