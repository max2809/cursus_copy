# Study Buddy v2 · Per-course RAG chat

**Date:** 2026-04-17
**Status:** Design approved, pending implementation plan
**Author:** Brainstorm session (this document)
**Supersedes:** nothing — additive to v1 dashboard

---

## Goal

Turn Study Buddy from a deadline dashboard into a per-course knowledge base. Each course gets its own chat that can answer questions grounded in that course's materials: Canvas files, assignment descriptions, and user-uploaded documents/URLs. Citations are inline and clickable. Materials stay fresh as Canvas updates.

## Non-goals (v2)

- Cross-course / global chat. (Per-course only. Users can open multiple chats.)
- Agentic tool-calling (deadline-aware "what should I study this week?"). That's v3.
- Multi-user collaboration on chats.
- Voice input / audio transcripts.
- Fetching books by name / library-proxy scraping.
- Exporting or sharing chat transcripts.
- Dark mode.
- Persisting the binary of user-uploaded files (we extract + discard; user keeps the original).

## User stories

1. **"What's on the midterm?"** — student asks in their Econ 101 chat, gets an answer grounded in lecture slides with inline `[1]` `[2]` citations linking to the slide PDF and page.
2. **"Explain Gini coefficient in simpler words"** — grounded answer from the relevant reading, citation points to the PDF.
3. **"Here's a book my prof recommended"** — student uploads a PDF of it to their course's Materials tab, waits ~1 minute for indexing, asks questions and gets answers citing it.
4. **"Prof posted lecture 8 this morning"** — student opens the app, sync fires, lecture 8 is auto-downloaded and indexed in the background. Chat can answer about it within ~20 seconds of opening the Chat tab.
5. **"I pasted a link to a Wikipedia article"** — student adds a URL to course materials, we fetch + extract readable text, index it, chat cites it.

## Architecture overview

```
Canvas sync (existing)                          User upload / URL (new)
      |                                              |
      v                                              v
 Files / deadlines upsert        →  Materials table (unified)
      |                                              |
      +---------------- enqueue index job  ----------+
                              |
                              v
                   BackgroundTasks worker
                              |
      Download → markitdown → chunker → Voyage embed → pgvector
                              |
                              v
                      files.indexed_at, chunks[]

User sends chat message
      |
      v
 Embed query (Voyage)
      |
      v
 pgvector cosine top-20 (filtered by course_id)
      |
      v
 Voyage rerank-2-lite → top-5
      |
      v
 Build prompt (system + history + top-5 with [1]-[5] markers)
      |
      v
 Claude Sonnet 4.6 (SSE stream)
      |
      v
 Frontend renders tokens + citation pills
```

## Data model

New migration: `0002_rag_chat.py`.

### Modifications to existing `files` table

- `canvas_file_id` — becomes nullable (was NOT NULL).
- Add `source` — text, enum `"canvas" | "upload" | "url"`, default `"canvas"`, NOT NULL.
- Add `source_url` — text, nullable. Set when `source = "url"`.
- Add `uploaded_at` — timestamptz, nullable. Set when `source IN ("upload", "url")`.
- Add `indexed_at` — timestamptz, nullable.
- Add `index_version` — int, nullable. Equals the global constant `studybuddy.rag.INDEX_VERSION` at the time of indexing; bump that constant whenever chunking or embedding logic changes, which enables bulk reindex (files with `index_version < INDEX_VERSION` are re-queued on next sync).
- Add `index_error` — text, nullable. Populated on parse/embed failure.
- Add `deleted_at` — timestamptz, nullable. Soft-delete marker for Canvas files that disappear upstream.

### Modifications to existing `deadlines` table

- Add `description_hash` — text, nullable. SHA-256 of the assignment description at last index time; lets us detect Canvas-side edits cheaply and re-chunk only when the hash changes.

### New table `chunks`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK users (cascade) | |
| `course_id` | UUID FK courses (cascade) | Always set. |
| `file_id` | UUID FK files (cascade), nullable | Null for assignment-description chunks. |
| `deadline_id` | UUID FK deadlines (cascade), nullable | Set for assignment-description chunks. |
| `source_kind` | text NOT NULL | `"file"` or `"assignment_description"` |
| `content_text` | text NOT NULL | The chunk text. |
| `chunk_index` | int NOT NULL | Order within the source document. |
| `token_count` | int NOT NULL | As counted during embedding. |
| `page_hint` | int, nullable | PDF page number if available. |
| `heading_path` | text, nullable | e.g., `"Chapter 3 > Elasticity > Price Elasticity"`. |
| `embedding` | `vector(512)` NOT NULL | Voyage voyage-3-lite is 512-dim. |
| `created_at` | timestamptz NOT NULL | |

Indexes:

- `ix_chunks_user_course` on `(user_id, course_id)` — scopes every query.
- IVFFlat or HNSW index on `embedding` with cosine ops — Neon supports both; use HNSW (better recall, minor index-time cost acceptable at our scale).

Unique constraint: `(file_id, chunk_index) WHERE file_id IS NOT NULL`, plus `(deadline_id, chunk_index) WHERE deadline_id IS NOT NULL`.

### New table `chat_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK users (cascade) | |
| `course_id` | UUID FK courses (cascade) | Every session is per-course. |
| `title` | text NOT NULL | Auto-generated from first user message (first 60 chars or Claude-summarized). |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Touched on every new message. |

Index: `ix_chat_sessions_user_course_updated` on `(user_id, course_id, updated_at DESC)` — powers the session-list sidebar.

### New table `chat_messages`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `session_id` | UUID FK chat_sessions (cascade) | |
| `role` | text NOT NULL | `"user"` or `"assistant"`. |
| `content` | text NOT NULL | Full message text (with `[N]` markers for assistant). |
| `citations_json` | JSONB, nullable | For assistant messages: `[{marker:1, chunk_id, file_id, source_url, page_hint, heading_path, snippet}, ...]`. |
| `error` | boolean NOT NULL default false | True if the stream errored mid-generation. |
| `created_at` | timestamptz | |

Index: `ix_chat_messages_session_created` on `(session_id, created_at)`.

## Ingestion pipeline

### Triggering

- Existing `sync_user` (in `studybuddy/sync/orchestrator.py`) already upserts files from Canvas. Extend it to:
  1. Detect changed/new files (`files.updated_at > files.indexed_at` OR `indexed_at IS NULL`).
  2. Detect changed assignment descriptions (hash `deadlines.description`; store hash in new `deadlines.description_hash` column, reindex if changed).
  3. Detect user-uploaded/URL materials where `indexed_at IS NULL`.
  4. Call `background_tasks.add_task(index_materials, user_id, course_id, [material_ids])`.
- `/api/deadlines` dashboard load already triggers sync. No new trigger needed for Canvas files.
- `POST /api/courses/{id}/materials` triggers index immediately via BackgroundTasks.
- Manual "Refresh" button in Materials tab → forces a sync + index cycle.

### Indexing worker

New module `studybuddy/rag/` with:

- `parser.py` — wraps `markitdown` (install via `pip install markitdown`). Input: file path or bytes + content-type. Output: markdown string + optional page-boundary annotations.
- `chunker.py` — markdown-aware splitter. Target 800 tokens, 100-token overlap, boundary-preserving at heading marks. Counts tokens via `tiktoken` (cl100k_base is close enough for Voyage). Emits `{text, chunk_index, page_hint, heading_path, token_count}`.
- `embedder.py` — Voyage client. Batches up to 50 chunks per request. Exponential backoff on 429/5xx. Returns list of 512-dim vectors.
- `downloader.py` — fetches Canvas file by id (uses user's PAT; follows signed-URL redirect). Fetches URL-sourced materials via `httpx` + `trafilatura` for HTML, or direct-to-bytes for PDF URLs.
- `indexer.py` — orchestrates: download → parse → chunk → embed → upsert chunks → update `files.indexed_at` and `index_version`. Per-file try/except so one failure doesn't halt the batch.

### Idempotency / re-indexing

- On re-index of a file: `DELETE FROM chunks WHERE file_id = :id` then insert new.
- Assignment-description reindex: `DELETE FROM chunks WHERE deadline_id = :id` then insert new.
- User-deleted materials: cascade delete chunks (FK).

### Chunker details

- Markdown-aware: split on `#`, `##`, `###` heading boundaries first.
- Oversize sections: sub-split on `\n\n` paragraph boundaries, aiming for ~800-token chunks with ~100-token overlap at each internal boundary.
- Never break mid-table. If a markdown table exceeds 800 tokens, keep it as a single oversized chunk (embedding quality degrades slightly but is better than splitting a table).
- Assignment descriptions are short — usually a single chunk each.
- `heading_path` is the `h1 > h2 > h3` stack at the point where the chunk starts. For PDFs without heading structure, `heading_path` is null and we fall back to `page_hint`.

## Chat pipeline

### Endpoint

`POST /api/courses/{course_id}/chat/sessions/{session_id}/messages` — SSE stream.

Request body:
```json
{ "content": "What's on the midterm?" }
```

Server behavior:

1. Validate session belongs to user and course.
2. Persist the user message (`role="user"`, no citations).
3. Embed the query via Voyage.
4. `SELECT * FROM chunks WHERE user_id = :u AND course_id = :c ORDER BY embedding <=> :q LIMIT 20`.
5. Voyage rerank-2-lite against the 20 → top 5.
6. Build messages array for Claude:
   - **System:** see below.
   - **Assistant-prior / User-prior pairs** from last 10 messages of this session (trimmed to last ~4000 tokens of history).
   - **User-current:** `{context_block}\n\n---\n\nQuestion: {user_query}`.
7. Stream `claude-sonnet-4-6` response via Anthropic SDK's streaming. Proxy tokens to client as SSE `data:` events.
8. On stream completion:
   - Parse `[N]` markers from full assistant text.
   - For each marker found, build citation entry using the ordered top-5 chunks (so `[1]` = first context block).
   - Save assistant message with `citations_json`.
   - Send final SSE event `event: done` with message ID + citations payload.
9. On stream error: save partial message with `error=true`, send SSE `event: error`.

### System prompt

```
You are a study assistant for {course_name} at {canvas_base_url}.
You have access to course materials (lecture slides, readings, assignment briefs, and anything the user has uploaded).

Rules:
- Answer using ONLY the provided context blocks below. If the context does not contain the answer, say so plainly — do not invent facts or draw on outside knowledge.
- Cite inline using [1], [2], ... matching the numbered context blocks. Place citations immediately after the claim they support.
- Keep answers concise and structured (short paragraphs, bullet lists when useful).
- Respond in the same language as the user's question when possible; course materials may be in English or Dutch.

Context blocks:
[1] {source_1_heading_path or filename} ({source_1_page_hint if set}):
{source_1_text}

[2] ...
```

History formatted as standard alternating user/assistant turns before the current user message.

### Retrieval parameters (tunable)

- Initial recall: 20 chunks.
- Rerank keep: 5.
- Minimum cosine-similarity floor on initial retrieval: 0.3 (below which the chunk is unlikely to be relevant, may as well be excluded).
- Context token budget per request: ~6000 input tokens (leaves room for history + 4000 generation).

## API surface

All under `/api/courses/{course_id}/...`, all require the current-user session cookie.

### Chat

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/chat/sessions` | Create a new session (optional body `{title}`; default title auto-generated on first message). |
| `GET` | `/chat/sessions` | List sessions for this course, most recent first. |
| `GET` | `/chat/sessions/{sid}` | Get a session with all messages + citations. |
| `POST` | `/chat/sessions/{sid}/messages` | Send a user message, get streamed assistant response (SSE). |
| `DELETE` | `/chat/sessions/{sid}` | Delete session + its messages. |

### Materials

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/materials` | List all materials (Canvas + uploads + URLs), with indexing status. |
| `POST` | `/materials` | Multipart file upload (PDF/PPTX/DOCX/TXT/MD, max 50MB). Returns material row; indexing proceeds in background. |
| `POST` | `/materials/url` | JSON `{url}` — fetch, extract, index. |
| `DELETE` | `/materials/{mid}` | Only `source IN ('upload', 'url')` — cannot delete Canvas-synced files. Cascades to chunks. |
| `POST` | `/materials/refresh` | Force a sync + index cycle for this course. |

### Files and mime whitelisting for upload

- `.pdf` (`application/pdf`)
- `.pptx` (`application/vnd.openxmlformats-officedocument.presentationml.presentation`)
- `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)
- `.txt` (`text/plain`)
- `.md` (`text/markdown`)

Anything else returns 415 Unsupported Media Type.

## UX / frontend

### Course view structure

- URL routing: `/?course={canvas_course_id}&view={deadlines|chat|materials}`. Default view: `deadlines`. Back button works.
- Sub-tab row inside each course view: **Deadlines · Chat · Materials**. Active tab = black pill, inactive = oat pill.

### Chat tab

**Desktop layout (≥ 768px):**

```
+-------------------------------------------------------+
| [ + New chat ] [ Recent: "Midterm prep" ] [ ... ]     |
+-------------------------------------+-----------------+
|                                     |  Sources        |
|  You: What's on the midterm?        |  [1] lec5.pdf   |
|                                     |     p.14        |
|  AI: The midterm covers [1] ch.3    |     "Supply &   |
|  and elasticity [2]. Key formulas   |      demand..." |
|  include [3]...                     |     Open in     |
|                                     |     Canvas →    |
|                                     |                 |
|                                     |  [2] slides.pptx|
|                                     |     p.7         |
|  [ Ask about CS101...       ] [→]   |  [3] ...        |
+-------------------------------------+-----------------+
```

- Left column (flex 2): messages. User messages cream background. AI messages white background. Inline `[N]` rendered as small black pill buttons.
- Right column (flex 1): "Sources" header, then numbered cards. Card shows: heading path (or filename), page hint, snippet (~3 lines), "Open in Canvas" or "Open material" link.
- Clicking an inline `[N]` pill scrolls the sources panel to that card and flashes it.
- Input: bottom-fixed textarea, auto-grow, Enter to send, Shift+Enter for newline. Send button = black pill with arrow.
- Top strip: horizontal scrollable recent-sessions pills + "+ New chat" button.

**Mobile layout (< 768px):**

- Sources column collapses into an accordion below each AI answer ("Sources · 3 ▾").
- Session pills scroll horizontally.

**Streaming states:**

- Before first token (retrieval + rerank): "Searching materials…" with Clay-styled spinner.
- During generation: tokens append with blinking caret.
- Error mid-stream: inline error pill under the partial answer with **Retry** button (re-sends last user message).
- Success: assistant message is finalized, citation pills become clickable.

**Empty state (no messages yet):**

- Welcome card: *"Ask me about {course_name}."*
- Three example query chips (clickable, populate the input): *"What's on the next exam?"*, *"Summarize the latest lecture"*, *"Explain [topic] in simpler words"*.

### Materials tab

```
+-------------------------------------------------------+
| Materials · CS101                     [ + Add ] [ ⟳ ] |
+-------------------------------------------------------+
| From Canvas · 12 files · last synced 2h ago           |
|   lec5.pdf · 14 MB · Canvas · Indexed · 2h ago        |
|   slides.pptx · 8 MB · Canvas · Indexing… · —         |
|   ...                                                  |
+-------------------------------------------------------+
| Your uploads · 2 items                                 |
|   Mankiw-ch3.pdf · 2.1 MB · Upload · Indexed · 1d ago  [🗑]
|   wikipedia: Gini coefficient · URL · Indexed · 2h ago [🗑]
+-------------------------------------------------------+
```

- **+ Add** opens modal with two tabs: **File** (drag-drop + picker) and **Link** (URL field).
- **⟳** force-refresh button → `POST /materials/refresh`.
- Each row: filename, size (if known), source pill, indexed status (dot: green = indexed, yellow = indexing, red = error), date.
- Hovering an error row shows tooltip with `files.index_error`.
- Canvas rows have no delete; upload/url rows have trash icon.

### Frontend stack additions

- Reuse existing stack for routing/data/styling — TanStack Query, React Router, Tailwind.
- New runtime deps: `react-markdown`, `remark-gfm` (GFM: tables, strikethrough) for rendering assistant answers.
- No Vercel AI SDK — overkill for a single-provider streaming flow and adds weight. Use native `fetch` + `ReadableStream` for SSE consumption.
- Add **EventSource** wrapper for SSE consumption, or fetch + ReadableStream. (No Vercel AI SDK — overkill for our single-provider flow and adds weight.)
- Citation rendering: small React component `<Citation n={1} onClick={scrollToSource}>` — renders as a tactile pill button with Clay shadow.
- Markdown rendering: `react-markdown` + `remark-gfm` for GitHub-flavored (tables, strikethrough). Custom renderer for `[N]` tokens (regex-parse and replace with `<Citation>`).

## Security / privacy

- PAT usage for Canvas file download: existing pattern from sync. PAT decrypted only for the life of the request.
- User-uploaded files stored temporarily in `/tmp` during parse; deleted immediately after indexing completes or fails. No persistent binary storage.
- URL fetching: 10s timeout, 50MB body cap, no following redirects to `file://` or private IPs. Use `trafilatura` with default guards.
- Chunks contain raw source text — treat them as user data (already covered by existing DB encryption at rest via Neon).
- Chat messages are persisted — user can delete sessions, which cascades to messages. Future v2.1: account-level "delete all chat data" button.
- Voyage and Anthropic API calls: no user PII sent beyond the query text and retrieved chunks (which the user's own Canvas PAT fetched).

## Dependencies / config

### New Python packages (pin via `pyproject.toml`)

- `markitdown>=0.0.2`
- `tiktoken>=0.7`
- `voyageai>=0.2`
- `anthropic>=0.40` (already transitively pulled by the humanizer project style; add explicitly here)
- `trafilatura>=1.12` (URL readability extraction)
- `sse-starlette>=2.1` (SSE helper for FastAPI)

### New env vars

- `VOYAGE_API_KEY` — required.
- `ANTHROPIC_API_KEY` — required.
- `RAG_CHUNK_TOKENS` — default 800.
- `RAG_CHUNK_OVERLAP` — default 100.
- `RAG_TOP_K_RECALL` — default 20.
- `RAG_TOP_K_RERANK` — default 5.
- `RAG_MAX_UPLOAD_MB` — default 50.
- `RAG_CLAUDE_MODEL` — default `claude-sonnet-4-6`.

### Frontend env vars

- None new — same API base URL as v1.

### Migration

Single migration `0002_rag_chat_init.py`:

1. `ALTER TABLE files ALTER COLUMN canvas_file_id DROP NOT NULL;`
2. `ALTER TABLE files ADD COLUMN source ...` (+ url, uploaded_at, indexed_at, index_version, index_error, deleted_at).
3. `ALTER TABLE deadlines ADD COLUMN description_hash text;`
4. `CREATE TABLE chunks ...` with HNSW index on embedding.
5. `CREATE TABLE chat_sessions ...`.
6. `CREATE TABLE chat_messages ...`.

## Testing

### Backend

- **Parser tests** — fixture PDF, PPTX, DOCX, Markdown. Assert extracted text contains known strings.
- **Chunker tests** — long markdown input with nested headings. Assert chunk count, token bounds, heading_path correctness, overlap amount.
- **Embedder tests** — mock Voyage client via `httpx_mock`. Assert batching, retry on 429.
- **Indexer tests** — end-to-end on a small fixture course: mocked Canvas download + real markitdown + mocked Voyage. Assert chunks written, `indexed_at` set.
- **Chat endpoint tests** — mock Voyage + mock Anthropic streaming. Assert retrieval filtered by course_id, citations populated, persisted correctly. Test streaming error path.
- **Materials endpoints** — upload a fixture PDF, assert material + chunks created after background task runs (use `BackgroundTasks` override or direct function call in test). Test URL ingest with mock HTTP response.
- **Freshness tests** — seed a file with `indexed_at < updated_at`, run sync, assert re-index fired (chunks replaced).

### Frontend

- Component tests: `Citation`, `SourceCard`, `ChatMessage`, `MaterialsTab` — rendering and interaction (click citation → scrollIntoView called).
- E2E smoke (manual): send a message, observe streaming tokens, click a citation, open Canvas link, upload a file, delete it.

## Risks

1. **Voyage free tier rate limits.** ~3 RPM on embeddings (unverified; confirm during build). Initial course index of 100+ files will rate-limit quickly. Mitigation: bump to Voyage paid (pennies at our scale) if free tier bites; batch aggressively; back off on 429.
2. **Canvas file download auth quirks.** The API returns signed URLs; bearer token handling at download time needs verification against real EUR Canvas. Mitigation: write a small integration script first, adjust downloader.
3. **markitdown quality on Dutch PDFs.** Some EUR courses are Dutch; markitdown uses pdfminer which handles Latin-1 encoded Dutch fine but math-heavy or scanned PDFs may extract poorly. Mitigation: accept degraded quality for v2; explicitly mention in README that scanned PDFs don't work well.
4. **Chat latency on first token.** Retrieval (200ms) + rerank (300ms) + Claude TTFT (~1s) = ~1.5s before first token. Feels slow. Mitigation: visible "Searching materials…" state; don't pretend it's instant.
5. **Cost creep.** Per-query is cheap but a curious user could spam. Mitigation: add per-user daily chat-query cap (default 200/day) in `studybuddy/chat/rate_limit.py`; soft limit returns a 429 with friendly UI.
6. **Background task failure silently drops indexing.** FastAPI `BackgroundTasks` errors are logged but don't retry. Mitigation: mark `files.index_error` on failure; surface in UI; manual **Refresh** retries.
7. **Big PDFs blocking the worker.** A 100MB textbook could take 30+ seconds to parse. Mitigation: enforce 50MB upload cap; for Canvas-side, same 50MB cap with `files.index_error = "too large"`; queue design should tolerate blocking (at 5 users, sequential indexing is fine).

## Rollout plan

1. **Migration** → deploy to Neon via Railway's `alembic upgrade head` prestart.
2. **Backend** → deploy, verify Canvas file download works against a real user's course.
3. **Dry-run index** → add CLI `studybuddy rag reindex --user-email=viliusjb@gmail.com --course-id=X` for manual testing.
4. **Frontend** → deploy Chat + Materials tabs behind a feature flag cookie (`sb_ff_chat=1`). Flip on for self-testing.
5. **Dogfood** for 1 week on real EUR courses.
6. **Public flip** — remove feature flag, announce to the 4 beta friends (post-DKIM domain work).

## Out of scope / future

- **v2.1** — store binaries in R2 for re-index without re-upload; per-user cost dashboard; streaming rerank; dark mode.
- **v3** — deadline-aware agent ("what should I study this week?"); tool-calling chat with `search_materials` + `get_upcoming_deadlines`; study-plan synthesis.
- **v4** — cross-course global chat with course attribution; shared courses between study-buddy groups; mobile PWA polish.

---

*End of design.*
