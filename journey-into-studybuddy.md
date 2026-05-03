# Journey Into Study Buddy

*A narrative reconstruction of the project's complete development history from claude-mem's persistent memory timeline.*

**Scope note:** The claude-mem worker tracks everything in this monorepo under the project name `ClaudeCode`. Study Buddy is the most recent major feature, but it inherits patterns and tooling established in earlier work on this repo (chiefly the AI Humanizer pipeline). This report centers on Study Buddy while acknowledging the pre-history that shaped it.

**Covers:** 2026-03-29 → 2026-04-17 · 166 observations · 4 memory sessions · 690,287 discovery tokens.

---

## 1. Project Genesis

Study Buddy didn't begin as a commitment — it began as a feasibility question. On **Apr 13 at 4:20 PM** (session `S145`), the user asked whether it was realistic to build a Canvas-scraping study assistant for Erasmus University Rotterdam students. That day was nominally about something else: debugging Windows kernel-power crashes and ripping out orphaned Apple USB drivers (`#197-208`) so the machine would stop rebooting mid-session. The Study Buddy question arrived as an aside at the very end of that stabilization work.

It lay dormant for three days. On **Apr 16 at 10:15 PM** (session `S146`), the user returned with real intent. What followed was a tightly-scoped design conversation — the archetypal "brainstorming skill" arc:

- **S146 → S151:** Feasibility assessment, technology stack selection, Canvas ingestion scope, data freshness strategy. One clarifying question at a time. Each answer narrowed the design.
- **11:24 PM (`#211`):** The v1 design specification was formalized — 12,716 discovery tokens of careful requirements work. Invite-only magic-link auth, PAT-based Canvas sync, per-user encryption at rest, bucket-grouped deadline dashboard, explicit v2/v3 readiness without v2/v3 features.
- **11:28 PM (`#213`):** Spec committed to version control as `docs/superpowers/specs/2026-04-16-studybuddy-design.md`.

The **founding technical decisions** — each visible in the early observations — were:

1. **Invite-only PAT model** over OAuth. The brainstorm surfaced that getting an OAuth developer key from EUR's Canvas admin could take weeks; PATs let five friends run the system today. (`S149`)
2. **Python FastAPI + Vite/React/Tailwind.** The user explicitly flagged dissatisfaction with AI-generated frontend aesthetics and said they'd design in Figma; this pushed the architecture toward a clean REST/SSE backend boundary that any frontend could plug into. (`S149`)
3. **Invite-only magic links** over "no auth at all." A single clarifying question — "do we really need auth for 5 friends?" (`S154`) — prompted a reconsideration. The conclusion: magic links now, because they carry forward to (c) public launch without rewrite, where no-auth would demand replacement. A small amount of engineering up-front bought a one-way door in the right direction.
4. **pgvector enabled from day one.** The spec bakes v2 readiness (course-material RAG) into v1 via an initial Alembic migration that creates the `vector` extension despite never being used. That discipline saved an entire infrastructure step when v2 eventually lands.

The problem being solved, stated plainly: students at EUR lose hours every week manually scanning Canvas for deadline changes across five or six courses. A unified, stale-aware dashboard that pulls from Canvas directly removes that polling chore.

## 2. Architectural Evolution

Study Buddy's architecture *barely evolved* during v1, which is itself the notable story. The spec set hard lines early and the implementation respected them. What did evolve:

**Test infrastructure (`#252`, 11:47 PM Apr 16 → 1:47 AM Apr 17).** The original plan tested against Postgres to match production. On Windows, `asyncpg` plus pytest-asyncio's ProactorEventLoop interaction produced teardown failures — connections left `idle in transaction` between tests, deadlocks on schema drops, cascading cleanup errors. The fix was a pivot to `aiosqlite` in-memory for tests while keeping Postgres/Neon for production. The same commit replaced `postgresql.UUID` with `sqlalchemy.Uuid` so the model definitions were portable across both dialects. This is the kind of adjustment that looks small in retrospect but consumed an hour of debugging in real time — and it was the only significant deviation from the written plan.

**Cookie strategy (`#298`, 3:33 AM Apr 17).** The spec said "session cookie, HTTP-only, SameSite=lax." This was written assuming same-origin deployment. In production, Vercel (`studybuddy-two-livid.vercel.app`) and Railway (`studybuddy-production-adb1.up.railway.app`) are different sites, and browsers silently strip SameSite=lax cookies from cross-site POSTs. Every authenticated API call returned 401. The fix — conditional `samesite = "none" if settings.cookie_secure else "lax"` — was architecturally minor but *surfaced only at deploy time*. This is the category of bug that unit tests cannot catch.

**Sync resilience (`#299`, 3:35 AM → `#300`, 3:37 AM).** The v1 plan treated Canvas API responses as uniformly well-behaved. Production traffic revealed that Canvas returns `404` when a course has a feature disabled (Quizzes off) and `403` when the student role lacks a permission (Files restricted). Both codes aborted the entire sync. Two commits in three minutes added graceful-skip handling for both statuses via a `_safe_get` helper. This was pure real-world learning; no amount of pre-design would have predicted that Canvas courses respond this way.

**Dashboard redesign (`#301-305`, 3:45-3:47 AM).** The original dashboard showed a single flat list of deadlines bucketed by urgency. After seeing the deployed app with three years of Canvas history, the user asked for course-by-course organization, hiding of stale items (30-day cutoff), and per-student submission state. This was a genuine v1.1 not captured in the original spec — and the fix was multi-layer: Canvas sync had to send `include[]=submission`, the sync code had to parse `submission.submitted_at` and `workflow_state`, the API had to restructure from flat `buckets` to `courses[].buckets`, the frontend needed a new `CourseSection` component, and `DeadlineItem` had to learn submitted-item styling (opacity, strikethrough, pill badge). That it shipped in under 10 minutes is a direct payoff of the test-aware, tightly-typed backbone laid during the plan.

## 3. Key Breakthroughs

A few moments had genuine "aha" quality — the transitions from investigation into resolution:

- **`#139` (Mar 29, 8:31 PM, humanizer-era):** DeBERTa model loading finally worked after iterative compatibility fixes against `transformers 5.4.0`. Not studybuddy, but established the "fix the library dep, not your code" reflex that later helped with `asyncpg` on Python 3.13.

- **`#214` (Apr 16, 11:37 PM):** The Study Buddy implementation plan was written. 93,303 discovery tokens in a single observation — the single most expensive memory in this project's history. This is the document that turned a design spec into 27 concrete TDD tasks with exact file paths, code blocks, and commit messages. Every later build step traced back to this plan.

- **`#252` (Apr 17, 1:47 AM):** Test infrastructure migrated from asyncpg to aiosqlite. This unblocked *all* subsequent backend tasks. Before this moment, pytest was unrunnable and the build was hostage to Windows event-loop bugs. After, 16 tests passed cleanly in under a second.

- **`#283` (Apr 17, 2:35 AM):** The clean `studybuddy-v1` branch cherry-picked from `humanizer-pipeline` onto `master`. GitHub's secret scanner had blocked the original push because a historic commit — from weeks earlier, nothing to do with Study Buddy — contained a Figma PAT in `.mcp.json`. The fix wasn't to rewrite history or revoke the token; it was to recognize that the work was linear and contiguous, extractable as a clean 27-commit sequence. This also retroactively justified the plan's discipline about commit scoping.

- **`#290` (Apr 17, 3:10 AM):** The backend went live on Railway and `curl https://.../health` returned `{"ok":true}`. This was the moment Study Buddy stopped being local code and started being a running service.

- **`#297-300` (Apr 17, 3:28-3:37 AM):** The flurry of cross-site auth fixes in production. PAT stripping, SameSite cookie correction, Canvas 404/403 tolerance. Each was a single-commit fix, each unblocked the next step in the end-to-end flow.

- **`#305` (Apr 17, 3:47 AM):** Dashboard redesigned into per-course cards with submission state and recency filtering. The user's first post-deploy feedback became production code in under ten minutes.

## 4. Work Patterns

The timeline separates cleanly into four phases, each with a distinct rhythm:

**Phase A — Humanizer sprint (Mar 29, ~2 hours).** 57 observations in a single evening (`#111-167`). Feature-heavy (`🟣` observations dominate). This was the session that established the subagent-driven-development workflow, the FastAPI+Vite+Tailwind template, and the "one subagent per task, review between" discipline. Study Buddy inherited all of these.

**Phase B — System stabilization (Apr 13, ~1 hour).** 12 observations, all discovery/bugfix (`#197-208`). Windows crashes, Apple USB drivers, hybrid sleep. No feature work. This was the "get the machine stable before starting anything ambitious" interlude.

**Phase C — Study Buddy design+plan (Apr 16, ~2.5 hours).** 10 observations on design conversation, decision documents, and plan writing (`#209-215` plus session-level entries `S145-S158`). Discovery-heavy in the planning sense. The single largest observation in the entire project history (#214, 93K tokens) landed during this phase.

**Phase D — Study Buddy implementation + deploy + iterate (Apr 17, 1:05-3:48 AM, ~2.75 hours).** 43 observations. Feature-heavy implementation (~30 `🟣`), peppered with bugfix cycles (`🔴`) during deployment. The rhythm was:
- **Rapid implementation sprint** (1:05-1:57 AM) — Tasks 1-19 backend, one commit every 3-5 minutes.
- **Frontend sprint** (2:16-2:21 AM) — scaffold, API client, pages all in five minutes.
- **Deployment slog** (2:26-3:10 AM) — this was the first phase where progress measurably slowed. Neon setup (fast), GitHub secret scanning block (detour), Railway config (many iterations), Python wheel issue (fix push), env var mangling (re-paste), domain flipping (internal vs public). Seven discrete obstacles in 45 minutes.
- **Bug-squash round** (3:18-3:37 AM) — PAT paste truncation, SameSite cookie, Canvas 404, Canvas 403. Each a 2-3 minute loop: symptom → diagnosis → commit → redeploy → retest.
- **Iteration** (3:40-3:48 AM) — user feedback on dashboard shape, refinements shipped in one coordinated commit.

The striking thing about Phase D is that **the ratio of debugging to feature work flipped right at the deploy boundary**. During local development (1:05-2:21 AM), feature commits dominated. Once the code hit Railway, bugfix commits dominated. Deployment is where unknown unknowns live, and that shows in the observation type distribution.

## 5. Technical Debt

Study Buddy v1 accrued modest, documented debt — most of it deliberate:

- **`RESEND_FROM=Study Buddy <onboarding@resend.dev>`.** Sandbox sender that only delivers to the Resend account owner's email. Fine for a 5-person closed beta; blocks real multi-user onboarding until a domain is verified. Flagged explicitly in the spec and carried forward into the Railway env vars.
- **`typer==0.12.5` + `click` incompatibility** caused the CLI to throw `TyperArgument.make_metavar()` errors at runtime (`S192`, 3:16 AM Apr 17). Worked around by invoking `invite_email` directly via a one-off Python snippet for the prod user invite. The CLI itself wasn't fixed; it's still broken on the deployed version. Documented as a known follow-up.
- **Empty-string secret defaults in `Settings`.** Code quality review on Task 2 flagged that `studybuddy_master_key: str = ""` and friends silently let the app boot misconfigured; the actual error would surface later with a confusing "must decode to exactly 32 bytes" message. Accepted as scaffolding-level acceptable, not fixed.
- **Base64 decode is strict standard, not URL-safe.** Same review flagged that `base64.b64decode` rejects keys generated via `secrets.token_urlsafe`-style tooling. Present as a latent footgun for anyone who generates keys with the wrong variant. Not triggered in practice because the suggested command in `.env.example` uses standard base64.
- **Aggressive test simplification.** Switching from Postgres-in-test to SQLite-in-test eliminated an entire class of Windows asyncpg bugs but means the test suite doesn't exercise `pgvector`, `BYTEA`-specific behavior, PostgreSQL UUID semantics, or `TRUNCATE ... CASCADE`. Production still runs the real thing, so this is acceptable — but the "one bug hits prod that tests missed" window is now wider than it would have been.

None of these are critical. Each is named in code comments or commit messages so a future reader knows they exist.

## 6. Challenges and Debugging Sagas

The single hardest debugging episode in Study Buddy's history was the **pytest teardown / Windows event loop saga** (`#252`, traceable through sessions around 1:30-1:47 AM Apr 17). Its arc:

1. First pytest run hung on the *first test* of `test_magic_link.py`. Zombie Postgres connections held `idle in transaction` state, blocking subsequent test setup's `DROP TABLE`.
2. Killing connections unblocked tests but introduced `ConnectionDoesNotExistError` mid-execution.
3. Pin session-scoped fixture loops via `asyncio_default_fixture_loop_scope = "session"`. Still failing at teardown with `RuntimeError: Event loop is closed`.
4. Apply `WindowsSelectorEventLoopPolicy` at the top of `conftest.py`. Still failing — pytest-asyncio's finalizer reopens a loop context that asyncpg cleanup callbacks can't reach.
5. Bite the bullet: switch to `aiosqlite`, refactor `models.py` to use portable `sqlalchemy.Uuid`, rewrite the entire `conftest.py` test engine fixture. Land all three changes in a single commit. All 16 tests pass.

This took about an hour of active debugging and yielded two artifacts: the commit that made every subsequent TDD cycle work instantly, and the institutional knowledge that asyncpg + Windows + ProactorEventLoop + pytest-asyncio is a combination to avoid in future Python projects on this machine.

The second-hardest episode was **the production environment variable paste disaster** (`S186`, 3:05 AM). The user pasted env vars via Railway's Raw Editor. The pasted block ended up containing `RESEND_API_KEY=# from resend.com dashboard` (the comment-line from `.env.example`), `DATABASE_URL` pointed at `localhost:5432`, and several values were `${{ secret(36, "...") }}` — Railway's random-secret template macros. The Railway deploy crashed with `Connect call failed ('127.0.0.1', 5432)`. The fix was to wipe and re-paste the correct values via Raw Editor. What made it hard wasn't the fix but the diagnosis: the stack trace pointed at SQLAlchemy's pool connect, not at "env var misread." Recognizing that `localhost:5432` meant "the default in `config.py`" — meaning no override arrived — was the leap.

A third, quieter saga was **the Canvas PAT paste truncation** (`S196-S197`, 3:21-3:28 AM). The user's PAT worked via `curl` but failed through the frontend. The form field was `type="password"` so you couldn't see the pasted value. Likely cause: browser autofill or manual selection cut off leading characters. The fix was defensive (`pat.strip()` plus diagnostic logging of `pat_len` and `pat_has_tilde=True`) rather than assertive (no UI change to reveal characters). In hindsight, a show/hide toggle would have made this a 30-second fix instead of a 7-minute round-trip.

## 7. Memory and Continuity

claude-mem's observation log meaningfully shaped this project in two ways:

**Carrying context between sessions.** The Mar 29 humanizer session established the subagent-driven workflow and the FastAPI+Vite+Tailwind template. When Study Buddy's Apr 16 design conversation asked "what stack?", the user's response referenced those exact patterns by name — and the answer recommended the humanizer template. That recommendation was grounded in lived experience (obs `#122-135`, the humanizer backend scaffolding sequence). Without the memory, the Study Buddy stack choice would have been from cold.

**Correcting stale assumptions.** At the very start of the Study Buddy design conversation, the assistant assumed EUR Canvas was at `canvas.eur.nl` without verification. The spec was written on that assumption. Later, when the end-to-end smoke test ran `curl https://canvas.eur.nl/api/v1/users/self` and got `401 Unauthorized`, the response was treated as confirmation that the host was right — because the user was eventually able to authenticate with a PAT against that host, the assumption held. This wasn't a memory win per se, but the *habit* of naming assumptions explicitly (from the brainstorming skill's discipline) made the verification natural.

**Zero explicit recall events.** The database shows 0 observations where `source_tool` or `narrative` references memory retrieval (`smart_search`, `get_observations`, "recalled", "from memory"). Study Buddy was built without looking back at prior memory — it was built with prior memory *passively injected* into the session at start (the `$CMEM ClaudeCode` header). This suggests passive context injection carries most of the value; explicit recall is more often a debugging tool than a daily-use feature.

## 8. Token Economics & Memory ROI

| Metric | Value |
|---|---|
| Total discovery tokens (work done across the monorepo) | 690,287 |
| Total read tokens (what memory presented back to new sessions) | 73,190 |
| Compression ratio | 89% savings vs reading original work |
| Total observations | 166 |
| Sessions with context available | 4 |
| Average discovery per observation | 4,158 tokens |
| Explicit recall events | 0 |

**Monthly breakdown:**

| Day | Observations | Discovery tokens | Sessions |
|---|---|---|---|
| 2026-03-29 | 57 | 260,650 | 1 |
| 2026-04-13 | 12 | 29,465 | 1 |
| 2026-04-16 | 54 | 281,947 | 1 |
| 2026-04-17 | 43 | 118,225 | 2 |

**Top 5 highest-value observations (most expensive to reproduce):**

1. `#214` — **Study Buddy v1 implementation plan created** (93,303 tokens). The 27-task plan with exact file paths, code, and commit messages. If this plan were lost, re-creating it would cost roughly 22% of the entire project's token budget.
2. `#116` — **AI Humanizer Pipeline Implementation Plan Created** (62,661 tokens). The template the Study Buddy plan patterned itself on.
3. `#215` — **Test fixtures improved in implementation plan** (51,028 tokens). The self-review iteration on `conftest.py` that pre-caught the asyncpg-on-Windows issues.
4. `#135` — **Humanizer frontend scaffolding** (20,705 tokens). Established the Vite+Tailwind+SSE pattern.
5. `#131` — **Persona System with Four Presets and Custom CRUD** (13,724 tokens).

**Passive recall savings estimate.** Sessions 2-4 each received ~50 observations as context at start. At a 30% relevance factor on the typical 50-obs window (4,158 × 50 ≈ 207,900 tokens of original work referenced per session), passive injection saved roughly **207,900 × 0.30 × 3 sessions ≈ 187,000 tokens of re-work** — versus a total read cost of 73,190 tokens. **ROI ≈ 2.5× on passive recall alone**, before counting explicit recall (none here).

The single most expensive memory (#214, the plan) is worth more than every day-to-day observation combined. This is a general pattern: architecture decisions and implementation plans concentrate value. Losing them would require redoing the hardest thinking. Incremental commit observations, in contrast, are near-free to regenerate by reading `git log`.

## 9. Timeline Statistics

- **Date range:** 2026-03-29 → 2026-04-17 (19 days elapsed, but only ~7 hours of actual work across 4 days).
- **Total observations:** 166 in the DB; 152 visible in the timeline. The 14-observation gap includes ancillary session-level entries.
- **Observation type distribution:**
  - Feature: 48 (29%)
  - Discovery: 40 (24%)
  - Change: 38 (23%)
  - Bugfix: 30 (18%)
  - Decision: 6 (4%)
  - Refactor: 4 (2%)
- **Most active day:** Apr 16 (54 obs, 281,947 discovery tokens) — driven by the design+plan writing in the late evening.
- **Second-most active day:** Apr 17 (43 obs, 118,225 tokens) — almost entirely Study Buddy implementation + deploy + iterate.
- **Longest single sprint:** Apr 17 1:05 AM → 3:48 AM (~2h 45min continuous work spanning 43 observations). The build-through-production-launch arc.
- **Commits on the Study Buddy feature branch:** 27 clean commits, cherry-picked onto a dedicated `studybuddy-v1` branch and pushed to `Mokzy/studybuddy` on GitHub as `main`.

## 10. Lessons and Meta-Observations

Reading the timeline end-to-end, a few themes rise:

**The cost of branching is discipline, the cost of skipping discipline is branching.** The Figma PAT in `.mcp.json` at commit `706337c` wasn't Study Buddy's fault, but it became Study Buddy's problem. Working on `humanizer-pipeline` instead of a fresh branch meant inheriting that history. The clean cherry-pick to `studybuddy-v1` added 10 minutes to the critical path at a stressful moment (3 AM, mid-deploy). In retrospect, a worktree or fresh branch at brainstorm time would have been cheap insurance.

**Test infrastructure changes have a multiplier.** The asyncpg → aiosqlite migration wasn't on the plan. It cost an hour of debugging. It also made every subsequent TDD cycle near-instant, which across 19 remaining backend tasks is easily worth that hour back multiple times over. Similarly, the portable `sqlalchemy.Uuid` change touched models.py once but affected every ORM query forever after.

**Production is where the unknown unknowns live.** Eight of the ten biggest surprises in this project came from deploy or post-deploy (Figma PAT block, Python 3.13 wheel, env var mangling, Railpack vs Nixpacks, Neon ssl=require vs sslmode=require, Canvas 404 on disabled features, Canvas 403 on restricted permissions, SameSite cookie cross-site stripping). None would have been caught by local tests. The implication: deploy early, deploy small, expect a bug-squash round, budget for it.

**The subagent-driven workflow is expensive on the controller.** Dispatched subagents did excellent focused work but cost significant controller tokens for orchestration. For straightforward tasks (file-copy scaffolding, config modules), the controller-does-it-directly path was faster and cheaper. The skill's rigid "subagent per task + two reviews" structure is right for tasks where implementer drift is a real risk; it's overhead when the task is mechanical. Mid-project, the workflow was downgraded from "every task gets the full ceremony" to "logic tasks get ceremony, scaffolding gets direct implementation."

**Design quality is a compounding asset, not a one-time expense.** The Clay design system reference (`DESIGN.md`, installed via `getdesign` at 2:04 AM Apr 17) cost nothing to obtain but shaped every subsequent frontend commit. The per-course dashboard redesign (3:45-3:47 AM) fit naturally into Clay's vocabulary because the vocabulary already existed. Compare to a project where each component re-invents its own styling.

**"Don't guess when you can verify."** The recurring fastest path through each bug was instrumentation followed by diagnosis — not speculation followed by retry. The PAT truncation fix added `print(pat_len=X, pat_has_tilde=Y)` before attempting any code change. That single print revealed `pat_len=70, tilde=True, canvas status=200` and immediately shifted focus to the *next* call in the sync chain (Quizzes → 404). Without the print, it's likely we would have chased a ghost in the onboarding logic.

---

**What a new developer would learn from reading this timeline:** the Study Buddy codebase is small (27 commits, one user, one dashboard), but every commit has lineage. Architecture came from a spec that came from a brainstorm. Tests exist because pytest was made to work on a hostile platform. The production config reflects real constraints discovered at deploy time, not assumed from documentation. The Clay aesthetic is deliberate and carried end-to-end. Nothing in this repo is there by accident.

If you forked this tomorrow and asked "why is SameSite set this way / why aiosqlite in tests / why the `_safe_get` 403 fallback / why the 30-day recency cutoff" — the timeline answers each one with a specific observation ID and a specific lesson learned the hard way.

## 11. Postscript: Frontend V2, Vercel, and Multi-University Canvas (May 2, 2026)

The next major continuity point happened on **May 2, 2026**, after the project had been renamed in practice from Study Buddy toward **Cursus** and the user fully switched to `frontend-v2`.

The first problem was deployment safety. An adversarial review found that the frontend-v2 path was still too easy to misdeploy: API calls could silently fall back to localhost, Vercel could build the wrong frontend root, and chat mode selection was not reliably carried through the full frontend-to-backend path. Commit `8ddb140` (`fix: harden frontend-v2 deployment path`) tightened this up:

- `frontend-v2` now requires `VITE_API_BASE_URL` for production builds.
- Localhost fallback is dev-only.
- API base resolution is covered by frontend tests.
- Chat modes (`tutor`, `quiz`, `flashcards`) now travel from frontend request to backend prompt.
- CoursePane polling behavior was fixed and tested.
- Backend onboarding/background tests were isolated so the suite stays reliable.

Verification for that work was broad: frontend tests passed, frontend production build passed with the expected large-chunk warning, and backend pytest passed (`127 passed` at that point). The commit was pushed to GitHub because Vercel deploys from GitHub. The operational reminder from this work: Vercel must build from `frontend-v2`, and the Vercel project must have `VITE_API_BASE_URL` configured.

The second problem was access control and Canvas portability. A user from another university could be allowlisted, receive a magic link, and then fail onboarding because Cursus validated every PAT against `canvas.eur.nl`. Investigation showed the root cause clearly: the onboarding endpoint used global `CANVAS_BASE_URL` for `/api/v1/users/self`, even though the `users` table already had a per-user `canvas_base_url` column and sync already used it.

After discussing OAuth, the decision was to keep the invite-only allowlist and improve the PAT flow instead. OAuth would give a nicer "Connect with Canvas" experience, but it still needs the Canvas install URL first and requires a Canvas Developer Key. A per-university key must be created by that university's Canvas admin; a global Instructure key is a larger vendor/partnership path. PATs are therefore still the practical route for "any Canvas university" while Cursus lacks billing, quota enforcement, and stronger public auth.

Commit `a2c84ff` (`docs: specify multi-university Canvas support`) captured the design and intentionally removed the old frontend-v1 `DESIGN.md` file. Commit `c7e38cf` (`feat: support multiple Canvas universities`) shipped the implementation:

- Onboarding now asks for `Canvas URL or domain` plus the Canvas PAT.
- Settings can update both the Canvas domain and PAT.
- The frontend accepts bare domains or pasted Canvas URLs and submits `{ pat, canvas_base_url }`.
- The backend normalizes the Canvas host, rejects unsafe hosts, resolves DNS, blocks private/internal targets, validates the token against the selected Canvas host, then saves `users.canvas_base_url`.
- `/api/auth/me` was added so Settings can prefill the saved Canvas host.
- Sync, downloads, citations, pages, and syllabus flows continue through the already-existing per-user `canvas_base_url`.

Verification after the multi-university work:

- Backend full suite: `144 passed`.
- Frontend full suite: `13 passed`.
- Frontend production build passed with the existing large-chunk warning.
- Both commits were pushed to `main` on GitHub (`8ddb140..c7e38cf`), leaving only the pre-existing untracked `13012-1776438198/` folder untouched.

The standing process change from this session: after every major Cursus update, update this journey file and the Codex memory file so the project history does not drift from the code.

## 12. Chat Citation Reliability (May 3, 2026)

On **May 3, 2026**, the next quality pass focused on the `frontend-v2` chat citations. The user reported that references were often wrong or only showed partial information. Investigation found two concrete causes:

- The frontend citation drawer resolved `[1]` globally across the whole session, scanning newest assistant messages first. Since each assistant response restarts citation numbering at `[1]`, clicking an older answer's `[1]` could open the newest answer's source instead.
- The backend citation snippet was the first 180 characters of the retrieved chunk, not the sentence that actually supported the claim before `[N]`. If the relevant sentence appeared later in the chunk, the drawer showed unrelated or partial context.

Commit `6064938` (`fix: improve chat citation targeting`) shipped the fix:

- `ChatPane` now resolves citation clicks against the clicked assistant message's own `citations_json`, so repeated markers across chat history no longer collide.
- Streaming citation clicks are also scoped to the streaming response's citation list.
- Backend citation extraction now reads the claim immediately before the marker and chooses the best matching sentence from the source chunk by content-word overlap.
- Snippets are clipped at a larger, sentence-focused length instead of blindly taking the chunk prefix.
- Regression coverage was added for both failure modes: a frontend test with two assistant messages that both cite `[1]`, and a backend test where the supporting sentence appears after unrelated chunk intro text.

Verification for the citation reliability work:

- Backend full suite: `145 passed`.
- Frontend full suite: `14 passed`.
- Frontend production build passed with the existing large-chunk warning.

The remaining known limitation is deeper than this patch: Cursus still trusts the model's chosen `[N]` marker once retrieval has selected the context. The May 3 fix makes the UI and drawer metadata faithful to the model's selected chunk, and makes the excerpt more useful, but future work could add post-generation citation verification or exact quote extraction if citation precision needs to become stricter.
