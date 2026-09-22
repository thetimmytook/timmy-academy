# Timmy Academy

Timmy Academy workspace with a public Benchmark API slice backed by synthetic in-memory data.

## Local development

Use Node.js 24 and npm. From the repository root:

```sh
npm ci
npm run dev
```

In VS Code, press **Ctrl+Shift+B** or run **Tasks: Run Task → Academy: dev** to start API, web,
and the contracts watcher in separate terminals. The task builds contracts first and closes that
preparation terminal. Contract changes are rebuilt automatically.

Open `http://127.0.0.1:5173`. The web app proxies `/api` to the local Cloudflare Worker on port 8787. `GET /api/bench/v1/health` returns `{ "status": "ok" }`. `dev` also
watches the shared contracts package. Use `npm run dev:web` or `npm run dev:api` for one app.

## Public Benchmark API

The [v1 contract](design/benchmark-backend-draft.md) is implemented by these anonymous routes:

- `GET /api/bench/v1/runs`: grouped search; `view=items&group_key=...` expands one group.
- `GET /api/bench/v1/runs/{publicRunId}`: one run's public details and reviewed settings.
- `POST /api/bench/v1/cohorts/query`: exact Position comparison, without publication.

Try `http://127.0.0.1:8787/api/bench/v1/runs?ram_gb=32&map=lighthouse` after `npm run dev:api`.
Repeat the same filters and sort with a returned `group_key` and `view=items` to see every run.
Copy a run's `public_run_id` into the detail route. A group is navigation, not an FPS aggregate.

Runtime Zod schemas and inferred types live in `packages/contracts/src/benchmark.ts`.
HTTP route registration and transport validation live in `apps/api/src/**/*.api.ts`;
`apps/api/src/index.ts` assembles the app and shared error handling; `apps/api/src/benchmark/` contains
the asynchronous repository boundary, query logic, synthetic fixtures and explicit public projections.
There are 24 fictional runs across three CPU/GPU/RAM-capacity tuples and four maps. No data is
loaded from Windows, local captures or real accounts. Settings and metrics belong to each run.

The fixture catalog recognizes the CPU/GPU display names in `fixtures.ts` for Position,
ignoring case and repeated whitespace; unrecognized names/maps return `422 invalid_input`.
Search takes exact canonical IDs and returns an empty result when none match. This limited catalog
is not a production hardware normalizer. Unknown game version/resolution stay `null` and yield
`missing_conditions` in Position. Graphics settings never become default equality conditions.
Derived render scale/upscaling remain `null`; quality notes stay empty until their codes are approved.

Pagination uses opaque SHA-256 tokens bound to the immutable fixture snapshot, filters, sort,
view, group and limit. Group keys allow a different item-page limit. Identical datasets work
across Worker instances with no token registry. This demo's snapshot lasts for the dataset's
lifetime; replacing the fixtures invalidates prior snapshots (`cursor_stale`/`group_key_stale`).
There is no wall-clock expiry policy yet. All API responses use `Cache-Control: no-store`.
The Position POST requires `Content-Type: application/json` (parameters are accepted) and
caps the body at 4 KiB before JSON parsing, including streamed requests. Unsupported or
missing media types return `415 unsupported_media_type`; oversized bodies return
`413 payload_too_large`. These policies are recorded in the v1 design contract.

Database work must supply durable snapshot/removal semantics and choose token expiry without
changing the handlers' repository interface. Production catalog normalization, approved warning
codes and abuse limits remain future work. Publishing must add validation/metric tolerances,
idempotency, moderation, deletion and retention. Authentication/provider selection and ownership
remain separate work; this slice implements no writes, owner endpoints or persistent storage.

## Style system

The permanent `/style-system` page shows the Academy palette, typography, shared component
recipes, states, and interactive examples. It is included in production builds and uses fictional
data only. Open it locally at `http://127.0.0.1:5173/style-system`.

`apps/web/src/theme.ts` owns the dark theme, semantic tokens, recipes, global styles and font
declarations. `apps/web/panda.config.ts` connects it to Panda; `src/style.css` contains only the
CSS layer entry point. Component and page layouts use Panda's generated helpers. Generated
`apps/web/styled-system/` files are ignored by Git and recreated by the web scripts.

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
