# MedVerse LMS — Architecture

Canonical documents. Code must follow these; **do not invent alternative states, transitions, or rules.** If a rule seems wrong, change the doc first (with approval), then the code.

## What this is

An online MCQ platform for MBBS students (Years 1–5 / Final Year) of a single academy:

- **Students**: after email verification, enter the LMS immediately (no admin enrollment approval). Two distinct content surfaces share the same records: **Resources** (free-student label for the admin-unlocked / `entitlement = 'free'` / grant subset of the academic tree) and the **full library** (same educational rows; subscribed students see the class → Block → category tree). Free students see paid nodes **locked** without paid catalog payloads. Dashboard shows incoming scheduled tests (FREE/PAID, datetime, countdown) plus a Top 3 leaderboard card for the relevant formal test; Tests is history/completed. Apply for subscription via manual bank transfer.
- **Admin**: Main Admin has all permissions across all classes; limited admins have granular permission codes **and** a separate assigned-class relationship (both required). Content management is **class/year first**, then Resources unlock vs full library, Question Bank, and Tests. Also manages curriculum, question versioning + review, tests (build → validate → preview → publish → kill-switch), **account status**, year-change requests, **subscriptions and payment applications**, resource entitlements/grants/restrictions, results, analytics.

This is a **one-academy, one-time LMS**, not a multi-tenant SaaS product. `tenant_id` remains on every table for a possible future split; it is a single constant today.

## Brand

MedVerse Healthcare identity: navy `#072855` + teal `#05AEA9`, sampled directly
from the logo at `public/logo-icon.png` (source: `public/logo-full.png`).
Use `public/logo-icon.png` (navy + teal) on light backgrounds and
`public/logo-icon-on-dark.png` (white + teal) on navy/blue backgrounds —
the shared `Logo` component (`src/components/logo.tsx`) picks the variant via
its `dark` prop and is the only place the wordmark/icon combination should be
assembled. Theme tokens live in `src/app/globals.css`. Product theme modes are
**Light / Dark / System** (SPEC FREEZE). If the logo is ever replaced,
re-sample these two hex values from the new asset and update both this doc
and `globals.css`.

## Progressive Web App

Native mobile apps remain excluded. Students and admins can **install the same
Next.js origin** as a Progressive Web App (`display: standalone`) from Android
Chrome (install prompt) or iOS Safari (Add to Home Screen). Installation does
not change authorization: a free student stays a free student; subscription
and exam rules stay server-enforced.

The service worker may cache hashed `/_next/static` assets and public branding
icons only. It must not cache HTML/RSC documents, PostgREST (`/rest/v1`), Auth
(`/auth/v1`), exam attempt payloads, private R2 objects (payment proofs, PDFs),
or other authenticated educational content. App updates wait until no live exam
player is open; they must not interrupt an in-progress attempt.

## Stack (approved production target)

| Layer | Choice |
|---|---|
| Public edge | Cloudflare (DNS, proxy, WAF as appropriate). Cloudflare Pages is **not** the LMS runtime. |
| Origin TLS / router | Caddy on the VPS (unified public origin) |
| Frontend + server actions | Next.js App Router, TypeScript, on the VPS |
| Data API | PostgREST on the VPS (`/rest/v1`) |
| Application database | PostgreSQL on the VPS (RLS, constraints, SECURITY DEFINER RPCs) |
| Auth | Supabase Cloud Auth only (`/auth/v1` proxied to the Cloud project) |
| Auth email | Brevo as SMTP **for Supabase Auth** (not a separate app mail API) |
| App backups | Encrypted PostgreSQL dumps to Cloudflare R2 |
| Private objects | Cloudflare R2: payment proofs and avatars are private keys streamed via authenticated Next proxies (`/api/payment-proofs/*`, `/api/avatars/*`) after authorize RPCs. Study PDFs/OSPE/pearls use the same proxy pattern. Admin study-PDF **upload** still uses short-lived presigned PUT (bytes never buffered in Next). Never a permanent public object URL. |
| Cron | pg_cron on VPS Postgres (primary): exam auto-submit (every minute) + subscription expiry / in-app expiry notices (daily is sufficient for notices). systemd timer hitting `/api/cron/auto-submit` (exam backup) |
| Client DB interface | supabase-js / `@supabase/ssr` + `supabase/migrations/*.sql` |

**Portability:** a later return to Vercel + managed Supabase must remain possible. Do not introduce Prisma, a custom exam REST layer, or a second query API. Env var **names** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) stay; only the URL origin changes.

Explicitly **excluded** unless a later measured requirement appears (approval + this doc first): Redis, queues/workers, Cloudflare Workers, Kubernetes, WebSockets-everywhere, microservices, a separate Node exam backend, ElasticSearch, AI question generation, event-driven architecture, mobile app, VPS-local object storage, payment gateways, Brevo transactional mail for subscription expiry (in-app notifications only for now).

**Realtime** is not part of the VPS design. Layer-1 session kick uses polling (see [permissions.md](permissions.md)), not `postgres_changes`.

## Production request path

```
Student browser
  → Cloudflare (DNS / proxy / WAF)
    → Caddy (TLS)
      → Next.js          (pages, server actions, /api/cron, health)
      → /auth/v1/*       → Supabase Cloud GoTrue (Brevo SMTP)
      → /rest/v1/*       → PostgREST → VPS PostgreSQL
```

Exam save/submit stay **browser → PostgREST → Postgres RPCs**. Next.js is not on that hot path after the exam page loads.

Caddy unifies one public origin so supabase-js keeps a **single** `NEXT_PUBLIC_SUPABASE_URL` (the Caddy hostname), matching today's client factories in `src/lib/supabase/{client,server,admin}.ts` and `src/proxy.ts`.

## Auth vs application PostgreSQL

Supabase Cloud holds **Auth only** (`auth.users`, sessions, refresh tokens, GoTrue). Application tables, RLS, and exam RPCs live on **VPS PostgreSQL**. They are not the same database.

JWT trust (unchanged claim semantics, split hosts):

1. Browser signs in via `/auth/v1` (Caddy → Cloud GoTrue).
2. Cloud issues an **ES256** (P-256) access token with `sub`, `role`, and `session_id`. (Legacy HS256 user tokens are not the current signing mode.)
3. Browser (and SSR) send that access token as `Authorization: Bearer` to `/rest/v1`.
4. PostgREST verifies it against the Cloud project's **JWKS** (VPS file `/etc/medverse/jwks.json`; never `NEXT_PUBLIC_`) and `SET ROLE`s to `anon` / `authenticated` / `service_role`.
5. Opaque Supabase API keys (`sb_publishable_*`, `sb_secret_*`) are **Auth `apikey` values only**. They are not PostgREST JWTs and must not be sent as `Authorization` on `/rest/v1`. No JWT → PostgREST `anon`.
6. `auth.uid()` and `auth.jwt()` in RLS and SECURITY DEFINER functions read PostgREST JWT GUCs (`request.jwt.claim.sub` / claims JSON). They do **not** join `auth.users`.

`service_role` still bypasses RLS. HTTP callers need a **JWT** with `role=service_role`. Opaque `sb_secret_*` is for Cloud Auth admin, not VPS PostgREST (`src/lib/supabase/admin.ts`). On the VPS, `auto_submit_expired` is primarily `pg_cron`.

**Profile provisioning:** Cloud `INSERT` into `auth.users` cannot fire a trigger on VPS Postgres. Required RPC: idempotent `ensure_profile()` — creates `profiles` (`account_status` default `active`) and an **active** class enrollment from JWT `sub` + `user_metadata.year_id` only when the subject has **never** had an enrollment row (first provision). Call it after signup / verify / signIn. Email verification does **not** wait for admin approval. Keep `handle_new_user()` in migrations so a return to managed Supabase still auto-provisions when Auth and `public` share a database.

**Access model (summary):** account status, class enrollment, subscription, and resource entitlement are separate. Free students enter after email verification. **Resources** (free-student surface label) is a presentation/curation surface over the same academic tree — not a second content store; only Admin-unlocked / free-entitled / granted nodes open. The full library remains a separate subscribed surface over the **same** educational rows (no duplicate free copies). Pending applications do not unlock paid content. Tests (`/tests`) is history; incoming scheduled tests live on Dashboard. Pearl Points is not assumed free or paid — each row’s entitlement columns decide. Details in [permissions.md](permissions.md), [database.md](database.md), and [access-eligibility-analytics.md](access-eligibility-analytics.md). Historical eligibility, missed tests, dashboard analytics, and leaderboard population are in [access-eligibility-analytics.md](access-eligibility-analytics.md). `/pending` remains as a compatibility/blocked-account route, not a registration-approval gate.

## Product structure freeze (SPEC FREEZE)

**Status:** frozen product law. Canonical docs only. Do **not** treat this section as authorization to write code, migrations, rename live data, create tables, or change staging/production until a later implementation pass is explicitly approved.

Architecture reconciliation (class-first academic tree) is complete. The decisions below supersede conflicting older product wording in these docs. They do **not** invent alternative exam states, scoring formulas, grace periods, or RLS precedence — those remain in [exam-state-machine.md](exam-state-machine.md), [scoring-rules.md](scoring-rules.md), and [permissions.md](permissions.md).

### 1. Class model (`years`)

Existing `years` rows remain the class model. Do **not** create a separate `classes` table.

| `year_number` | Canonical display name |
|---|---|
| 1 | 1st Year MBBS |
| 2 | 2nd Year MBBS |
| 3 | 3rd Year MBBS |
| 4 | 4th Year MBBS |
| 5 | **Final Year MBBS** (existing Year 5 / “5th Year” may be **displayed** as Final Year MBBS; display rename is not a new class entity) |

### 2. Academic structure (second level = Blocks / Final Year subjects)

Student-facing second level under each class. Product names map onto existing `subjects` (reinterpreted) — see § migration risk. Do **not** invent a parallel `blocks` table.

| Class | Second-level nodes |
|---|---|
| 1st Year MBBS | Block 1, Block 2, Block 3 |
| 2nd Year MBBS | Block 4, Block 5, Block 6 |
| 3rd Year MBBS | Block 7, Block 8, Block 9 |
| 4th Year MBBS | Block 10, Block 11, Block 12 |
| Final Year MBBS | Medicine, Surgery, Gynecology, Pediatrics |

### 2b. Block / Final Year subject chrome categories

Each Block (and each Final Year clinical subject) shows these student-facing chrome entries:

| Category / group | Notes |
|---|---|
| MCQ Bank | Practice with instant feedback — admin-managed **folders** under the Block / Final Year subject (`mcq_bank_folders`); each folder holds PDFs (`material_folders.library_type = mcq_bank`) and **subfolders** (`mcq_bank_subfolders`); MCQs attach to a subfolder (`questions.mcq_bank_subfolder_id`, with denormalized `mcq_bank_folder_id`). Hierarchy: Folder → Subfolder → MCQs. Question Bank taxonomy (year → departmental subject → book → chapter → topic) remains internal metadata for authoring/search — not a competing student navigation. |
| One Liner | Admin-created **folders** of PDFs under the Block / Final Year subject (`material_folders.library_type = 'one_liner'`, `content_surface = 'academic'`, required `subject_id`). Student opens via the existing materials PDF reader + highlights. Legacy `pearl_points` Q&A rows are retained but are **not** the student product model. |
| Guidelines | Study guidelines / protocols |
| Books | Reference texts |
| Lectures | Lecture videos / recordings |
| Notes | Class notes — PDFs via existing `material_folders.library_type = 'notes'` + protected study-content reader (`content_surface = 'academic'`, folder `subject_id` = Block / Final Year subject) |
| Syllabus | Subject syllabus PDFs — same materials model with `library_type = 'syllabus'` and `content_surface = 'academic'` (distinct from Prof. Session syllabus folders, which use `content_surface = 'prof_session'`) |
| **OSPE** (group) | Parent chrome only — children below |
| → OSPE Material | OSPE PDFs and station packs |
| → OSPE Lectures | OSPE lecture media |
| → OSPE Practice | Links to the existing global `/practice/ospe` surface (not a Block-scoped content store) |

**Notes**, **Syllabus**, and **One Liner** reuse the existing materials lifecycle (folders → `materials.kind = 'pdf'` → `/materials/[id]/read` → `/api/study-content/...`). Do **not** fold Notes into Books. Do **not** create a second PDF store. Legacy `/notes` and `/pearl-points` may remain as deep links; primary entry is Block / Final Year subject chrome.

**OSPE Practice** is **not** a top-level shell nav item; students reach it from the Block OSPE group (or deep link).

**Flashcards** is **not** a student block category in this IA (placeholder-only product note remains in §10). Combined/legacy OSPE library packs may still exist in storage; the student Block tree remaps or omits them from Block category chrome.

### 2b-ii. Past Papers (top-level shell nav)

**Past Papers** is a first-class student shell nav item (not a Block chrome category). Storage reuses `material_folders` / `materials` with `library_type = 'past_papers'`.

Hierarchy (frozen):

**Past Papers → Sub Nav (root folder) → optional Sub-Sub Nav (child folder) → PDF materials**

- Sub Navs are `material_folders` with `library_type = 'past_papers'` and `parent_id` null.
- Sub-Sub Navs are the same type with `parent_id` set to a Sub Nav (cycle-guarded `parent_id`; depth is not product-limited beyond the existing DB guard).
- PDFs (`materials.kind = 'pdf'`) may attach to **either** a Sub Nav or a Sub-Sub Nav folder.
- Scoped to the student’s **enrolled class year** (`material_folders.year_id` + existing folder view/access helpers). Do not invent a global past-papers catalog outside year enrollment.
- Section lock: without a live subscription the shell entry is locked (same pattern as Books / Lectures materials hubs). Individual folder entitlement remains the content boundary after unlock.
- Soft-delete / Bin / R2 purge use the existing materials lifecycle. Do not create a parallel CMS.

### 2b-iii. Other Services (top-level shell nav)

**Other Services** is a first-class student shell nav item. Storage reuses `material_folders` with `library_type = 'other_services'` (one folder row = one service).

- Folder `name` = service title; optional folder `description` = user-facing blurb; optional Drive `materials` row (`kind = 'drive'`) and/or protected study-content PDF materials (`kind = 'pdf'`) under the folder.
- Year-scoped like other materials (`year_id` + enrolled class).
- **Hub is free / unlocked:** students may open Other Services without a live paid subscription. Individual folder entitlement (`free` / `any_subscription` / plan) remains the content boundary — do not treat hub access as making every service paid, and do not globally weaken RLS.
- Soft-delete / Bin / R2 purge use the existing materials lifecycle. Do not invent a marketplace or second CMS.

### 2b-iv. Career Counseling Series (top-level shell nav)

**Career Counseling Series** is a first-class student shell nav item, **independent of Other Services**. Do **not** nest it under Other Services, reuse `/other-services` as its parent route, or store its folders as `library_type = 'other_services'`.

Storage reuses `material_folders` / `materials` with `library_type = 'career_counseling_series'`.

Hierarchy (frozen):

**Career Counseling Series → Folder (root, `parent_id` null) → PDF materials**

- **Universal (not class-scoped):** CCS folders store `year_id` **null**. Catalog visibility does **not** depend on the student’s enrolled class, subscription year, Block/Final-Year subject, or class-specific entitlement. Any active LMS student (any valid class) sees the same hub. Do **not** apply Other Services / Past Papers year filters here.
- Nesting under folders is out of scope for this hub (flat folders only; `parent_id` null).
- PDFs (`materials.kind = 'pdf'`) use the protected study-content reader (`/materials/[id]/read` → `/api/study-content/...`) — never a public R2 URL.
- **Hub is free / unlocked:** students may open Career Counseling Series without a live paid subscription and without selecting a particular academic class first. Individual folder entitlement (`free` / `any_subscription` / plan) remains the content boundary (default `free`).
- Soft-delete / Bin / R2 purge use the existing materials lifecycle. Do not create a parallel CMS.
- Admin surface: `/admin/career-counseling-series` (no class picker — one academy-wide catalog). Student surface: `/career-counseling-series` (folder list) → `/career-counseling-series/[folderId]` (open folder). Legacy `/career-counselling` redirects to the student hub.

### 2c. Prof. Session (guided course under enrolled class)

**Prof. Session** is a first-class student nav node. Students see **only** Blocks / Final-Year subjects for their **current enrolled class** (`enrollments.year_number`), using the same product_key map as Academic (§2d).

Hierarchy (frozen):

**Prof. Session → [enrolled class] → Block / Final-Year subject →**

Block/Subject-level (Prof. Session surface — **not** Academic Block categories):

- Syllabus (PDF)
- Schedule (PDF and/or structured table stored as materials)
- Books · Notes · Lectures (YouTube / Google Drive via existing materials)
- OSPE → Past OSPE (PDF/pictures) · Practice OSPE (existing `/practice/ospe` engine, subject-filtered) · OSPE Lectures
- **MCQ Bank** → Admin-created **Days** only (no fake Day 1/2/3)

Each Day contains exactly: Guidelines (PDF) · LoS (PDF) · Practice MCQs (select existing Question Bank MCQs and/or CSV import on the day authoring screen — day-scoped junction only) · Test MCQs (CSV/manual via exam `tests` linked to the day) · One-Liners (`one_liners` table + optional PDF — **not** Pearl Points).

Primary routes under `/academic/prof-session/...`. Legacy `/resources/...` and `/library/...` redirect into `/academic`.

**Access (frozen):** Free students see Prof. Session in navigation but the **entire** surface is locked (subscription CTA). Do not expose Day or Block Prof. Session contents as free content. Subscribed students enter and see only their enrolled class.

### 2d. Student academic navigation (frozen)

Shell nav and Academic home show **only the student’s current enrolled class** (`enrollments.year_number`) and that class’s Blocks / Final-Year subjects. Free students may **change class** (§6); after a class change, chrome and Academic home show the new class’s blocks only. Subscribed students remain locked to their subscription year (§6). Deep links to another year’s academic routes redirect to the enrolled year’s academic home. Individual content remains governed by its own entitlement. Do **not** use Resources = free tree / Library = full tree as the primary student navigation model — one academic hierarchy (`/academic`) for everyone.

### 3. Notes

**Notes** remains a distinct **storage** `library_type` (not folded into Books or Past Papers). Preserve `material_folders.library_type` / category identity for Notes in admin and DB. Student **Academic** Block / Final Year subject chrome **includes** Notes (`content_surface = 'academic'`, §2b). Student **Prof. Session** Block/Subject chrome also **includes** Notes (`content_surface = 'prof_session'`). The two surfaces do not share folder rows — filter by `content_surface`.

### 4. Leaderboards (presentation; ranking source unchanged)

- **Student dashboard Top 3** (formal-test board card): rank, profile picture, name, college, **Score**.
- **Analytics Top 20**: rank, profile picture, name, college, **Score**.

Population and ordering remain **`rank_test` on submitted formal-test attempts only** ([scoring-rules.md](scoring-rules.md), [access-eligibility-analytics.md](access-eligibility-analytics.md)). Do **not** invent a second ranking engine or a cumulative class board in this freeze.

### 5. Limited Admin class scope

- Separate **assigned-class** relationship (admin ↔ year), independent of `admin_permissions`.
- Existing permission codes remain separate job authorization.
- **Main Admin** sees all classes (no assignment rows required).
- Limited Admin requires **both** class assignment **and** the relevant permission code.

### 6. Free student vs subscription class lock

| Student state | Class change |
|---|---|
| Free (no live subscription, no pending application) | May change class **freely** (self-serve). |
| Pending subscription application | Class is **locked** for the pending period. |
| Active / live subscription | Class is **locked** to `subscriptions.year_id` (purchased class). Change only via existing admin-mediated year-change / promote paths, keeping subscription class in sync. |

Subscription **application** stores the selected purchase class. Subscription **approval** stores / activates that purchased class on the subscription row.

### 7. Resources (free surface)

- Free-student surface label: **Resources** (replaces “Free Resources” as the product label; routes/docs may still mention the old name as historical).
- Same academic tree as the full library.
- Only Admin-unlocked / free-entitled / granted nodes **open**.
- Free resources **do not** duplicate educational rows — entitlement / grants / restrictions only.
- Full library remains a **separate** subscribed surface over the same store.

### 8. Formal exam model

- Existing exam state machine remains frozen ([exam-state-machine.md](exam-state-machine.md)).
- **Test MCQ** remains a formal timed test (`tests` + attempt RPCs).
- Practice remains separate from exams.
- **`rank_test`** remains the only ranking source.

### 9. Practice (product law; separate from exams)

Filters / states: **All / Remaining / Done / Favorites** (`practice_progress.marked`); **Incorrect** set (`practice_progress.incorrect`, maintained by `submit_practice_answer`); Practice Incorrect mode (`mcq_bank_subfolder_incorrect` / folder-aggregate `mcq_bank_folder_incorrect`); favorite/unfavorite; Done → Remaining reset; percentage completion; forward practice timer; practice report. Primary practice unit is the **subfolder**; folder/bank progress aggregates child subfolders. **No** reuse of `test_attempts` for practice. See [database.md](database.md); do not invent attempt states.

### 10. Flashcards

**Placeholder only.** No flashcard engine and no flashcard content table in this freeze. Flashcards is **not** one of the eight student Block categories (§2b).

### 11. Search

Search is limited to **folders / subfolders / tree names** (class, Block/subject, folder, day/container names as those entities exist). No full-text search of stems, PDF bytes, or video.

### 12. Theme

Student/admin shell theme modes: **Light / Dark / System**.

### Major data-migration risk (subjects → Blocks)

**Existing `subjects` currently represent departments** (e.g. Anatomy, Physiology) and are **referenced by Question Bank / material / pearl data** (`questions`, folders, denormalized `subject_id` chains, CSV import taxonomy under subjects → books → chapters → topics).

Reinterpreting `subjects` as Blocks 1–12 and Final Year clinical subjects **must** use a **controlled mapping / backfill**, not destructive renaming of live department rows in place. Do not drop FKs, mass-rename in production without a mapping plan, or invent a second parallel subject tree. Authoring taxonomy (`books` / `chapters` / `topics`) may continue to hang under the reinterpreted subject rows after an approved mapping migration — that migration is **out of scope** for this SPEC FREEZE pass.

**VPS `profiles.id`:** UUID primary key equal to Auth `sub`. **No** `references auth.users (id) ON DELETE CASCADE` on the VPS — that FK cannot exist without a local `auth.users` table. User-delete semantics without CASCADE are **pending approval** (see [deployment.md](deployment.md)).

## Scale (planning estimates — unverified)

Academy planning figures (not measured capacity): ~10,000 students in the ecosystem, ~5,000 possible free-trial signups, up to ~1,500 simultaneous exam participants, with possible synchronized submit/expiry bursts.

A **single VPS of approximately 8 vCPU / 24 GB RAM** is the current **planning estimate**, not a capacity guarantee. 1,500-user behavior is **unverified** until load tests run through the VPS PostgREST path (never production). See [deployment.md](deployment.md).

Ranking must be **coalesced** before a 1,500-submit event — hosting does not remove per-submit `rank_test` lock cost. See [scoring-rules.md](scoring-rules.md).

## Object storage (R2)

**Payment screenshots (now):** private Cloudflare R2 object keys on `subscription_applications` (`payment-proofs/{tenant_id}/{student_id}/{uuid}`); **upload** is server-mediated (`putR2Object` after WebP optimize — no browser presigned upload); **read** is `GET /api/payment-proofs/[applicationId]` after `authorize_payment_screenshot_access` (no browser-visible signed R2 URL). Never a public URL. Same R2 platform as backups — not a new infrastructure category. **Production requires `R2_PAYMENT_BUCKET`** (dedicated payment bucket; never falls back to the backup `R2_BUCKET`). Non-production may use `R2_PAYMENT_BUCKET` or, as a convenience, `R2_BUCKET` for a shared private bucket. **Avatars:** private keys under `study-content/avatars/`; browser reads via `GET /api/avatars/[studentId|me]` after `authorize_avatar_object`.

**Study materials:** `materials.kind` is `drive` (Google Drive URL), `pdf` (private R2 object), or `guideline` (text body). Existing Drive rows stay `kind = 'drive'`. Student catalog SELECT must not leak `drive_url`, `body_text`, or R2 object keys; open via entitlement-checked RPCs. PDFs use the **same private objects bucket** as payment proofs (`R2_PAYMENT_BUCKET` in production; non-production may share `R2_BUCKET`) with prefix `study-content/`. **Upload:** authenticated admin begins an HMAC-sealed upload session; the browser uploads bytes **direct to R2** via short-lived presigned PUT (small files) or multipart UploadPart URLs (large files). Next.js never buffers the PDF body. After R2 completion the server HEAD + range-reads magic bytes (`%PDF-`), then inserts the `materials` row. **Read:** `GET /api/study-content/[materialId]` re-checks `authorize_study_object`, then **streams** R2 bytes (including HTTP `Range` / `206`) without buffering the whole object in Node. Students use an in-app **PDF.js** reader (range/chunk loading, text layer for selection, private `pdf_highlights` persistence, pinch zoom, true fullscreen chrome hide via Fullscreen API — browser/system chrome cannot be removed). Temporary R2 URLs and credentials never reach the browser. **Offline:** explicit “Save for Offline” stores the file in origin-private OPFS + IndexedDB metadata with entitlement expiry — not the user Downloads folder; not absolute DRM. Cover/thumbnail keys follow the same prefix (covers still go through a small Server Action body ≤2MB). **No artificial PDF size cap** — ceiling is R2 platform limits. **No new Cloudflare bucket** for this phase. Incomplete multipart uploads should be aborted on cancel; configure R2 AbortIncompleteMultipartUpload lifecycle as a safety net.

**Legacy pearl points:** lightweight recall items in `pearl_points` (not `question_versions`). Retained for admin archive; student One Liner chrome uses `material_folders.library_type = 'one_liner'` PDF folders. Answers remain RPC-only on the legacy table.

**OSPE Practice stations:** image + hidden-answer items in `ospe_stations` (not library OSPE folders, not MCQs, not exam attempts). Same entitlement columns; private R2 under `study-content/`; answer and object key are RPC-only (`open_ospe_station` / `authorize_ospe_station_object`).

**Test preparation guidelines:** optional `test_prep_guidelines` row keyed by `test_id`. Frozen after the test leaves `draft`. Student body is returned only after `can_access_test`. Catalog visibility of a test does not leak the guideline.

**Books/notes/video (FUTURE):** add a `materials.kind` (or a similarly narrow table) and the same signed-R2 + entitlement pattern. Do not invent a generic CMS. Must not be stored as permanent VPS-local public files and must not expose ordinary permanent download URLs or public MP4s.

## Core principles

1. **Postgres enforces everything security- or correctness-critical**: RLS on every table (deny-by-default), constraints, unique indexes, security-definer RPCs. App-level checks are UX, not security.
2. **Server clock is the only clock.** Client timers are display-only.
3. **Explicit state enums, never boolean flag soup** (`status text check (...)`, one column).
4. **History is immutable**: question versions are append-only; attempts are never deleted (invalidated, with reason, at worst); published test_questions are frozen snapshots.
5. **Idempotency everywhere in the exam path**: duplicate/out-of-order requests must be harmless.
6. **`tenant_id` on every table** from day one (single constant now; future multi-academy).
7. **All admin mutations of consequence are audit-logged.** Student-originated applications/requests are stored on those tables; students cannot write `audit_logs`.
8. **No new infrastructure category** without a measured need and an update to this doc.
9. **Authorization is Postgres RLS + permissioned SECURITY DEFINER RPCs.** `profiles.role = 'admin'` is not a blanket write grant. App-level checks are UX only.

## Repository layout

Note: this project uses **Next.js 16** — request middleware lives in `src/proxy.ts` (Next 16 renamed `middleware` to `proxy`; same functionality). `cookies()`, `headers()`, `params`, `searchParams` are async.

```
docs/                    # these canonical documents
deploy/                  # VPS templates (Caddy, systemd, backup) — not live host config
supabase/migrations/     # SQL source of truth (numbered)
supabase/seed.sql
supabase/tests/          # pgTAP
src/app/(public|student|admin)/...   # route groups
src/lib/supabase/{server,client,admin}.ts
src/lib/actions/         # server actions wrapping RPCs
src/components/{ui,exam,admin,dashboard}
tests/{e2e,unit}
```

## Related docs

- [database.md](database.md) — schema (identity, account status, class enrollment, subscriptions, entitlements)
- [permissions.md](permissions.md) — account vs subscription vs class vs resource, admin permissions, session policy, RLS matrix, **8L student notification inbox contract**
- [access-eligibility-analytics.md](access-eligibility-analytics.md) — current access vs historical eligibility vs academic history vs UI; missed tests; dashboard; leaderboards (8J source of truth)
- [exam-state-machine.md](exam-state-machine.md) — attempt lifecycle (single source of truth)
- [scoring-rules.md](scoring-rules.md) — marking, grace policy, ranking **when** vs **what**
- [test-rules.md](test-rules.md) — test lifecycle, validation, kill switch
- [deployment.md](deployment.md) — environments, Caddy, cron, backups, health, cutover, pending approvals, `deploy/` templates
- [schema-lane-integration-contract.md](schema-lane-integration-contract.md) — parallel-lane DB/RPC contract (schema lane exclusive)
- [validation/README.md](validation/README.md) — append-only environment validation / phase sign-off archive (staging 8J complete ≠ production authorize)
