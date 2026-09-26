# Repository instructions

Timmy Academy is currently in the design stage. The Windows Benchmark application and skills remain in `D:/projects/tarkov-skills`; this repository owns the future web site and API. Do not create application code or tooling from the design drafts until implementation is requested.

## Current product direction

- All Timmy Academy user-facing interface text is in English, including benchmark wireframes, navigation, dialogs, and future Academy screens.
- Keep the initial web app simple: React + Vite with client-side rendering. Treat per-run SSR, generated HTML and Astro as options to revisit only when a concrete indexing or product need warrants them. News pages may be static later.
- Keep `apps/web`, `apps/api`, and `packages/contracts` as the proposed npm workspace boundaries. Add only packages that have a real consumer.
- Keep deployment and environment configuration separate under `infrastructure/` when implementation begins. Use distinct test/staging and production environments.
- Respect the privacy boundary in `design/benchmark-backend-draft.md`: public benchmark records use an explicit allowlist, and raw captures or private identifiers are never published.

## Implementation and review approach

- Name boolean-returning predicates with an `is` or `are` prefix, as grammatically appropriate (for example, `isConsistentCapture`), so their return type is clear at call sites.

- When the user says to discuss, agree, or record a decision without implementing it, do not edit application code or tests. Record the decision and wait for an explicit instruction to implement it.
- Implement only the agreed current step. Do not add behavior for future workflows or tests that manually simulate those workflows before they are implemented. Keep existing data safe without implementing speculative lifecycle branches.
- Keep fixture data separate from production rules. Do not use hardcoded test models or preserve demo IDs as exceptions in production normalization.
- Use Drizzle for repository queries and D1 batch transactions, following existing repository patterns. Use small parameterized `sql` fragments where the query builder needs them; do not default to handwritten `.prepare().bind()` queries in application repositories.
- Do not add production constructor parameters or abstractions solely to support tests. Use `Date.now()` directly for cursor expiry and `vi.spyOn(Date, 'now')` with cleanup in tests.
- Validate untrusted input at its boundary. Avoid redundant guards for internal values already guaranteed by the authenticated principal, types, or database constraints. Keep required parameters required.
- Choose consistency guarantees according to the product need. Owner pagination is a live keyset list without a watermark; do not reintroduce snapshot machinery for new inserts without an agreed requirement.
- Keep runtime configuration centralized and simple. Do not add regex/schema validation for our own configuration without a concrete need; retain required-setting checks.
- Use explicit Hono route modules and grouped routers with shared middleware. Do not introduce folder-based routing or other infrastructure before it has a real need. Name modules for their current responsibility, such as `benchmark-cursor`.

## API file naming

- Put HTTP route registrations and request/response validation in `apps/api/src/<feature>/<feature>.api.ts` (for example, `benchmark/benchmark.api.ts`). Use the `.api.ts` suffix consistently, including when a feature is split into smaller route modules; do not introduce a competing `.endpoint.ts` convention.
- Keep `apps/api/src/index.ts` for app assembly and shared middleware/error handling. Keep repository/query logic, fixtures and public projections outside `.api.ts` files; shared runtime contracts belong in `packages/contracts`.
- Name HTTP tests `*.api.test.ts` when adding a dedicated route-module test file. Existing broader integration tests may retain their names.

## Web UI conventions

- Keep reusable, domain-independent UI components in `apps/web/src/elements`. Start with a flat library; introduce atom/molecule/organism folders only when its size makes that useful.
- Put route-level components in `apps/web/src/pages`. Both the component and its file name must end in `Page` (for example, `BenchPage.tsx`, `RunPage.tsx`, `StyleSystemPage.tsx`). Keep `App.tsx` for app assembly and route selection.
- Keep Benchmark-specific components, API access and search state in `apps/web/src/bench`. Elements must not import Benchmark contracts or fetch feature data. Split components by responsibility, without speculative abstractions or a separate package before it has a real consumer.
- Use PascalCase component files and simple names such as `Button`, `Dropdown`, `Input`, `Field`, and `Message`. Avoid redundant `Control` suffixes. A native select is exposed as `Dropdown`; this naming does not require a third-party UI library.
- Use the shared elements in product pages and the style-system page. Keep visual tokens and recipes in `theme.ts` and Panda; do not duplicate control styling in pages. Generate all supported recipe variants when wrapper props prevent static extraction.
- Preserve native HTML semantics, keyboard behavior, accessible labels, refs and native attributes. `Button` renders a button for actions (default `type="button"`, explicit `type="submit"` for submission) and an anchor when given `href`. Modified clicks and external links retain normal browser behavior.
- Format UI files with the repository's shared Prettier configuration, including `.tsx`. Do not add UI-only ESLint whitespace or blank-line rules to imitate formatting. Use meaningful blank lines and small components to keep code readable.

## Git hygiene

- Split implementation into small, independently reviewable substeps instead of accumulating one large commit. For each substep, implement it, run relevant checks, show the user the concrete changes for a mini review, and wait for their approval before committing. Then continue with the next substep and repeat. An implementation request alone does not authorize commits. Do not rewrite history or discard user changes.
- Keep each approved commit limited to one coherent change (for example, schema and migration, repository behavior, local seed, or deployment wiring). Inspect the staged diff and stage only files belonging to that reviewed step. Do not sweep unrelated or unfinished working-tree changes into a commit.
- Name new branches by change type and purpose: `feat/<purpose>`, `fix/<purpose>`, `docs/<purpose>`, or `chore/<purpose>`. Do not use an agent or tool name as a branch prefix. Use `master` as the primary branch.
- For feature and fix commits, use the Benchmark repository format: `feat|fix # UI | BE # Description`, choosing `UI`, `BE`, or `UI | BE` for the affected area. For documentation and maintenance commits, use `docs` or `chore` with the same `type # area # description` structure when appropriate.
- Commit only with the repository user's locally configured Git identity. Never add an agent/tool name, generated-by text, or co-author trailer to commits, PRs, release notes, or repository metadata unless the user explicitly requests it.
- Merge pull requests with a merge commit. Do not squash or rebase PRs; preserve branch history.
- Keep commit messages and PR descriptions focused on the change summary. Do not add generic verification sections or command lists unless the user requests them or a material test limitation needs explanation.
- Keep generated benchmark captures, run results, temporary output, build artifacts and secrets out of Git unless the user explicitly asks to version a sanitized example.
- Do not inspect or poll remote CI, deployment jobs, or their status after a push or merge unless the user explicitly asks to check them. The user will say when to verify. When a run is started, provide its link without querying its status.
