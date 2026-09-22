# Timmy Academy

Timmy Academy workspace with a public Benchmark web UI and API backed by persistent Cloudflare D1 storage. Fictional data is an explicit local/staging seed.

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
These plain-text collection files live beside the API code in Git; there is no second repository
or filesystem link to maintain. The collection uses only synthetic public data and sends no
authentication or publication request.

Runtime Zod schemas and inferred types live in `packages/contracts/src/benchmark.ts`.
HTTP route registration and transport validation live in `apps/api/src/**/*.api.ts`;
`apps/api/src/index.ts` assembles the app and shared error handling; `apps/api/src/benchmark/` contains
the asynchronous repository boundary, query logic, synthetic fixtures and explicit public projections.
There are 24 fictional runs across three CPU/GPU/RAM-capacity tuples and four maps. No data is
loaded from Windows, local captures or real accounts. Settings and metrics belong to each run.

The initial catalog recognizes the CPU/GPU display names in `catalog.ts` for Position,
ignoring case and repeated whitespace; unrecognized names/maps return `422 invalid_input`.
Search takes exact canonical IDs and returns an empty result when none match. This limited catalog
is not a production hardware normalizer. Unknown game version/resolution stay `null` and yield
`missing_conditions` in Position. Graphics settings never become default equality conditions.
Derived render scale/upscaling remain `null`; quality notes stay empty until their codes are approved.

Pagination uses opaque persisted navigation tokens with a fixed 30-minute lifetime. New publications
are excluded from existing snapshots; updates/deletions invalidate them with 409. Cursors bind
filters, sort, view, group and limit, and use keyset continuation. See the [D1 policy, setup commands
and staging acceptance table](infrastructure/README.md#d1-persistence-and-migrations). All API
responses use Cache-Control: no-store.
The Position POST requires `Content-Type: application/json` (parameters are accepted) and
caps the body at 4 KiB before JSON parsing, including streamed requests. Unsupported or
missing media types return `415 unsupported_media_type`; oversized bodies return
`413 payload_too_large`. These policies are recorded in the v1 design contract.

Production catalog normalization, approved warning codes and abuse limits remain future work.
Publishing must add validation/metric tolerances, idempotency, moderation, deletion and retention.
Authentication/provider selection and ownership remain separate work; this slice adds storage
for anonymous reads without public write or owner endpoints. Empty databases stay empty; no
fixture fallback is used. Seed is explicit, idempotent and forbidden on production.

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
not inferred; recorded quality codes and mode tokens retain their saved values. The profile
icon is a noninteractive placeholder. No auth, owner actions, Position or Academy pages are added.

UI integration tests use the real Hono read routes with synthetic test data to cover navigation,
filtering, both cursors, null settings, errors and out-of-order requests. The current options
endpoint returns all distinct observed values in one response; a large production dataset will
need a searchable/paginated options contract. Real publication data remains future backend work.

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

## Follow-up after the D1 merge request

1. Fix the ESLint configuration and remaining lint failures at their source. Make local checks,
   pre-commit checks and CI agree; retain useful type-aware rules instead of broadly disabling them.
2. Migrate infrastructure `.mjs` scripts to TypeScript where the runtime and tooling allow it.
   Keep `.mjs` only where a tool requires JavaScript configuration or a TypeScript entry point
   would add unnecessary runtime complexity.
