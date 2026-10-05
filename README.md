# Timmy Academy

Timmy Academy workspace with public Benchmark browsing, authenticated submissions and owner
controls, and moderator approval backed by Cloudflare D1. Synthetic data is added only through
explicit seed commands; there is no runtime fixture fallback.

## Local development

Use Node.js 24 and npm. From the repository root:

```sh
npm ci
npm run db:seed:local
npm run dev
```

In VS Code, press **Ctrl+Shift+B** or run **Tasks: Run Task → Academy: dev** to start API, web,
and the contracts watcher in separate terminals. The task builds contracts first and closes that
preparation terminal. Run **Academy: seed local DB** separately for initial fictional data or
after a schema change; **Academy: reset local DB** clears local Benchmark data without removing the
schema. Contract changes are rebuilt automatically.

Open `http://127.0.0.1:5173`. The web app proxies `/api` to the local Cloudflare Worker on port 8787. `GET /api/bench/v1/health` returns `{ "status": "ok" }`. `dev` also
watches the shared contracts package. Use `npm run dev:web` or `npm run dev:api` for one app.

For browser sign-in, copy `infrastructure/.dev.vars.example` to `.dev.vars` in that
directory and configure the local Clerk instance there. The frontend loads its public
key from `/api/config` through the same Vite proxy; it needs no Vite environment key.
Without runtime config, public benchmarks remain available. See
[runtime config and key rotation](infrastructure/browser-auth.md).

## Public Benchmark API

The [v1 contract](design/benchmark-backend-draft.md) is implemented by these anonymous routes:

- `GET /api/bench/v1/runs`: grouped search; `view=items&group_key=...` expands one group.
- `GET /api/bench/v1/runs/{publicRunId}`: one run's public details and reviewed settings.
- `GET /api/bench/v1/filter-options`: distinct CPU/GPU, RAM, map, resolution and game-version values observed in public runs.
- `POST /api/bench/v1/cohorts/query`: exact Position comparison, without publication.

Try `http://127.0.0.1:8787/api/bench/v1/runs?ram_gb=32&map=lighthouse` after `npm run dev:api`.
Repeat the same filters and sort with a returned `group_key` and `view=items` to see every run.
Copy a run's `public_run_id` into the detail route. A group is navigation, not an FPS aggregate.

For manual API exploration, open `api-collections/benchmark-v1` as a collection in Bruno, select
the `Local` environment, and start `npm run dev:api`. The `API` folder has one editable request
per public endpoint. Start with Search groups, then Runs in group and Run details; returned IDs
are saved automatically. If you change search filters or sort, repeat them when opening a group.
The `Smoke flow` folder contains ordered requests with checks for search, pagination, details,
Position and an invalid filter. Run that folder to check the complete flow. With Bruno CLI
installed, run `bru run "Smoke flow" --env Local` from `api-collections/benchmark-v1`.
The `Resource telemetry` folder checks eight full-demo scenarios after explicit
`db:seed:demo:local`; see [collection instructions](api-collections/benchmark-v1/README.md).
These plain-text collection files live beside the API code in Git; there is no second repository
or filesystem link to maintain. The collection uses only synthetic public data and sends no
authentication or publication request.

Runtime Zod schemas and inferred types live in `packages/contracts/src`.
HTTP route registration and transport validation live in `apps/api/src/**/*.api.ts`;
`apps/api/src/index.ts` assembles the app and shared error handling; `apps/api/src/benchmark/` contains
the asynchronous repository boundary, query logic, synthetic fixtures and explicit public projections.
The local/staging fixture seed contains 24 fictional runs across three CPU/GPU/RAM-capacity tuples
and four maps. Fixtures do not read Windows captures or real accounts. Published owner submissions
use the same public projections; settings and metrics belong to each run.

Hardware normalization trims and collapses whitespace and derives stable CPU/GPU IDs from the
complete case-insensitive names, without a fixture allowlist or fuzzy matching. Supported map IDs
live in `catalog.ts`; unknown maps return `422 invalid_input` for Position and submissions.
Search takes exact canonical IDs and returns an empty result when none match.
Unknown game version/resolution stay `null` and yield
`missing_conditions` in Position. Graphics settings never become default equality conditions.
Derived render scale/upscaling remain `null`; quality notes stay empty until their codes are approved.

Pagination uses client-held, HMAC-signed navigation tokens with a fixed 30-minute lifetime. New publications
are excluded from existing snapshots; updates/deletions invalidate them with 409. Cursors bind
filters, sort, view, group and limit, and use keyset continuation. See the [D1 policy, setup commands
and staging acceptance table](infrastructure/README.md#d1-persistence-and-migrations). All API
benchmark responses use Cache-Control: no-store. The public runtime configuration has
its own versioned cache policy described in [browser-auth.md](infrastructure/browser-auth.md).
The Position POST requires `Content-Type: application/json` (parameters are accepted) and
caps the body at 4 KiB before JSON parsing, including streamed requests. Unsupported or
missing media types return `415 unsupported_media_type`; oversized bodies return
`413 payload_too_large`. These policies are recorded in the v1 design contract.

Anonymous reads expose only published runs. Empty databases stay empty. The fixture seed supports
only local/staging; the separate manual demo seed can target production and marks its measurements
as synthetic. See [synthetic data policy](infrastructure/synthetic-benchmarks.md).

## Submissions, ownership and moderation

Protected owner routes require a verified Clerk browser session or desktop OAuth principal:

- `POST /api/bench/v1/me/runs`: validate and store a submission for review.
- `GET /api/bench/v1/me/runs`: list the current owner's submissions.
- `GET /api/bench/v1/me/runs/by-client-id/{clientRunId}`: retrieve an owner receipt.
- `DELETE /api/bench/v1/me/runs/{publicRunId}`: remove an owned publication.

Upload requires JSON with a 256 KiB body limit and a required `resource_telemetry` block.
Missing or null telemetry is rejected; explicit `not_collected`, partial coverage, unavailable
measurements and UMA are supported. The server checks the strict input allowlist,
capture metric consistency and normalized settings, handles idempotent retries, rejects duplicate
measurements within the same account, and enforces a rolling per-account submission quota.
New submissions return `pending_review` with no public ID or URL; upload never publishes a run.

Browser moderators can inspect the pending queue and approve or reject submissions through
`/api/admin/v1/approvals`. Moderator capability comes from Clerk's server-read admin role; ordinary
owners and desktop sessions cannot use admin routes. Owner deletion removes the public run and
retains an anonymous measurement archive that public readers do not expose.

See [submission contracts and lifecycle](infrastructure/benchmark-submissions.md),
[resource telemetry and desktop handoff](infrastructure/resource-telemetry.md),
[moderator access and decisions](infrastructure/admin.md), and
[browser/desktop authentication](infrastructure/browser-auth.md).
Trust scoring, anomaly detection, quarantine, FPS aggregate eligibility, approved warning codes
and archive retention policy remain future work. Arithmetic consistency checks establish valid
input, not proof that a capture is authentic.

## Public Benchmark UI

Open `/bench/` for immediate grouped results and `/bench/runs/{publicRunId}` for one capture.
CPU, GPU, RAM and map are the main filters; More conditions exposes execution, selected game
resolution and exact game version. Options come from the read-only API, never a bundled catalog.
They describe the current public dataset, not all supported hardware. Unknown URL selections
remain visible and return exact matches or an empty result; filters never widen automatically.

Filters, capture-date sort, page size, hardware cursor, expanded group and run cursor live in the
URL. Changing filters or sort clears both cursors and expansion. Expansion replaces the preview
with paginated individual runs (five per page), without duplicating or averaging preview values.
Pagination offers the next and first pages; browser Back revisits previous pages. BENCH and Back
to search results restore the last browse URL in this tab, saved in session storage when available.
A direct detail visit with no saved browse URL falls back to `/bench/`. Vite and the existing
Cloudflare SPA asset fallback both serve direct detail URLs on refresh.

The UI has loading, empty, invalid-link, unavailable-run and retry states. Missing settings are
not inferred; recorded quality codes and mode tokens retain their saved values.
Public detail and moderator review show capture-window CPU, GPU, RAM, pagefile and commit
summaries; My Bench cards show aggregates without individual processor/pagefile arrays.
Measurements describe the whole system or selected adapter, including other applications.
Unknown values remain unavailable rather than zero. Memory is shown in GiB; a near-full VRAM
hint suggests a repeated texture-quality A/B test and does not establish the cause of FPS drops.
Clerk sign-in and sign-up live at `/sign-in` and `/sign-up`. The profile menu opens My Bench
at `/bench/me`, where owners view submission status and can remove published runs. Browser
moderators also have `/admin` for pending approvals. Public browsing requires no sign-in.
Position has an API but no dedicated page; the other Academy product pages remain future work.

UI integration tests use the real Hono read routes with synthetic test data to cover navigation,
filtering, both cursors, null settings, errors and out-of-order requests. The current options
endpoint returns all distinct observed values in one response; a large production dataset will
need a searchable/paginated options contract.

## Public contracts and private policy

This repository is public. Shared schemas, enum values, explicit public projections, basic input
and capture consistency checks, ordinary idempotency, public reads, synthetic fixtures and API
collections remain public. Schema acceptance does not establish authenticity or authorize
publication; publication is currently a moderator decision.

Future trust scoring, anomaly detection, abuse heuristics, quarantine and aggregate eligibility
rules belong to private server implementation when those features are agreed. They may evolve
without changing public transport contracts and must not enter browser bundles or shared contracts.
An admin page's browser code is visible to clients; access to its data and operations is enforced
by the server. Private submission data means restricted access, not private source code.

No repository split is implemented here. Before adding private policy, the build must also keep
the compiled Worker, related tests, logs and deployment artifacts private: the current public
Actions artifact contains the Worker. Preserve one build and promotion of the same artifact,
with every source revision pinned. See the
[architecture boundary](design/timmy-academy-architecture.md#111-public-contracts-and-private-policy).

## Style system

The permanent `/style-system` page shows the Academy palette, typography, shared component
recipes, states, and interactive examples. It is included in production builds and uses fictional
data only. Open it locally at `http://127.0.0.1:5173/style-system`.

`apps/web/src/theme.ts` owns the dark theme, semantic tokens, recipes, global styles and font
declarations. `apps/web/panda.config.ts` connects it to Panda; `src/style.css` contains only the
CSS layer entry point. Component and page layouts use Panda's generated helpers. Generated
`apps/web/styled-system/` files are ignored by Git and recreated by the web scripts.

Reusable UI components live in `apps/web/src/elements` and are shared by Benchmark and the
style-system page. Route components live in `apps/web/src/pages`, with `Page` in both their
component and file names. Benchmark-specific components and data access stay in `src/bench`.
See `AGENTS.md` for naming, accessibility and formatting conventions.

Typography, spacing, radii, controls and page widths use `rem`, converted from the draft's
16px reference root. The root stays at `100%` to respect the browser's default font size.
Borders, focus-ring thickness and subtle shadows keep pixel units. SVG chart coordinates and
labels use SVG user units so they scale together inside the chart's viewBox.

IBM Plex Sans (400/600/700) and Mono (400/600) are self-hosted Latin1 WOFF2 files under
`apps/web/public/fonts/`, with their OFL license and pinned source revision. Add other subsets
before introducing another interface language. Darker warning/error backgrounds improve text
contrast over the original draft; `fg.faint` is reserved for decorative or disabled details.

The root npm overrides keep Panda's pinned PostCSS, selector parser and Browserslist dependencies
on patched releases. Revisit these overrides when Panda updates its dependency pins.

## Planned error reporting

Windows error reports will go through the Academy API into GitHub Issues.
This is deferred work; see [the recorded direction](design/error-reporting.md).

## Checks

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run test:watch` runs Vitest in watch mode. Husky installs a pre-commit hook during `npm ci`;
lint-staged formats and lints staged source files. Deployment and GitHub Actions setup are described
in [infrastructure/README.md](infrastructure/README.md).

## Tooling follow-up

Infrastructure scripts, the Drizzle configuration and the ESLint configuration use TypeScript.
Node.js 24 runs the standalone database commands directly; the seed command uses `tsx` because
it imports application modules. ESLint loads its TypeScript configuration through `jiti`.

ESLint enforces braces and spacing around statements and comments across the workspace. Local,
pre-commit and CI checks use the same configuration, including type-aware rules.
