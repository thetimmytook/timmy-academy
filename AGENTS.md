# Repository instructions

Timmy Academy is currently in the design stage. The Windows Benchmark application and skills remain in `D:/projects/tarkov-skills`; this repository owns the future web site and API. Do not create application code or tooling from the design drafts until implementation is requested.

## Current product direction

- All Timmy Academy user-facing interface text is in English, including benchmark wireframes, navigation, dialogs, and future Academy screens.
- Keep the initial web app simple: React + Vite with client-side rendering. Treat per-run SSR, generated HTML and Astro as options to revisit only when a concrete indexing or product need warrants them. News pages may be static later.
- Keep `apps/web`, `apps/api`, and `packages/contracts` as the proposed npm workspace boundaries. Add only packages that have a real consumer.
- Keep deployment and environment configuration separate under `infrastructure/` when implementation begins. Use distinct test/staging and production environments.
- Respect the privacy boundary in `design/benchmark-backend-draft.md`: public benchmark records use an explicit allowlist, and raw captures or private identifiers are never published.

## Git hygiene

- Do not commit unless the user asks. Do not rewrite history or discard user changes.
- Name new branches by change type and purpose: `feat/<purpose>`, `fix/<purpose>`, `docs/<purpose>`, or `chore/<purpose>`. Do not use an agent or tool name as a branch prefix. Use `master` as the primary branch.
- For feature and fix commits, use the Benchmark repository format: `feat|fix # UI | BE # Description`, choosing `UI`, `BE`, or `UI | BE` for the affected area. For documentation and maintenance commits, use `docs` or `chore` with the same `type # area # description` structure when appropriate.
- Commit only with the repository user's locally configured Git identity. Never add an agent/tool name, generated-by text, or co-author trailer to commits, PRs, release notes, or repository metadata unless the user explicitly requests it.
- Merge pull requests with a merge commit. Do not squash or rebase PRs; preserve branch history.
- Keep commit messages and PR descriptions focused on the change summary. Do not add generic verification sections or command lists unless the user requests them or a material test limitation needs explanation.
- Keep generated benchmark captures, run results, temporary output, build artifacts and secrets out of Git unless the user explicitly asks to version a sanitized example.
- Do not inspect or poll remote CI, deployment jobs, or their status after a push or merge unless the user explicitly asks to check them. The user will say when to verify. When a run is started, provide its link without querying its status.
