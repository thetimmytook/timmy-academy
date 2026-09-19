# Tooling selection from `D:/Downloads/template`

Status: agreed design. A minimal workspace scaffold and deployment configuration were added on 2026-09-19.

## Proposed structure when implementation begins

```text
apps/
  web/           # React/Vite site
  api/           # Cloudflare Worker/Hono API
packages/
  contracts/     # versioned HTTP schemas and TypeScript types
infrastructure/   # deployment and environment configuration when needed
```

`D:/projects/tarkov-skills` remains the separate Windows Benchmark and skills project. Its C# app consumes HTTP/JSON API contracts. Keep auth provider integration isolated in `apps/api`; create a separate package only if a second deployable needs to reuse it. Do not create `packages/ui` until there is a second UI consumer.

## Web rendering decision

Keep the initial `apps/web` architecture simple: React + Vite with client-side rendering for the interactive Academy and benchmark UI. Do not introduce Astro, per-run SSR or a static-HTML generation pipeline for individual benchmark reports before a concrete indexing need justifies it. The public run detail URL remains stable and can initially load its data from the API. News pages, if introduced, may be generated as static HTML. Revisit rendering choices when the actual UI and indexing requirements are known.

## Deployment and request routing decision

- Build `apps/web` as static Vite assets. Publish those assets together with the `apps/api` Hono Worker as one Cloudflare deployment per environment. Keep the web and API source code in their existing separate workspaces.
- Cloudflare Workers Static Assets serves the SPA's HTML, JavaScript, CSS and images without invoking the Worker script. Configure the SPA fallback to `index.html` for browser navigation. Route only `/api/*` to the Worker script with selective `assets.run_worker_first`. Do not set `run_worker_first: true` for every request.
- Use `timmy.academy` for production and `staging.timmy.academy` for staging. The web app calls same-origin `/api/...` endpoints in each environment. Keep their deployment configuration and secrets separate.
- There is no initial need for a separate Cloudflare Pages project, R2 bucket or S3-like store for the SPA. Revisit separate deployments only if a concrete operational need appears.
- Wrangler and GitHub Actions now encode this scheme. Cloudflare-side Worker creation and live deployment are pending the first workflow runs.

See Cloudflare's [Static Assets routing](https://developers.cloudflare.com/workers/static-assets/) and [billing rules](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) for current platform behavior.

## Agreed package, contract and environment decisions

- Use npm workspaces. The root scripts invoke workspace scripts explicitly with `npm run <script> -w <workspace>`. A root build runs `contracts` before its consumers; each app declares its workspace dependency. Package entry points must match actual build output. Do not copy the sample project's missing shared-package build step or mismatched `main` paths.
- `apps/api` and `apps/web` consume one `packages/contracts` package; do not copy HTTP DTO types between them. Use unique names such as `@timmy/contracts`, not generic package names such as `types` or `utils`.
- Put versioned public HTTP request and response schemas in `contracts`. Zod schemas provide runtime shape validation and inferred TypeScript types. The API performs additional server-side checks for ownership, limits, privacy and plausible benchmark metrics. Internal database and UI types stay with their owning app; provider-specific auth types do not enter the public benchmark contract.
- The Windows Benchmark stays in `D:/projects/tarkov-skills`. Publish a versioned OpenAPI description of `/api/bench/v1` for its C# integration. A generated C# client/DTO is an option when the contract stabilizes; the generation tool is not selected yet. The desktop app explicitly maps its local run model to the sanitized publication DTO. Do not copy or publish `Models.cs` wholesale.
- Keep deployment and environment material in a separate `infrastructure/` directory. Plan distinct test/staging and production environments before deployment. Adapt this organization to Cloudflare Workers/Wrangler rather than copying the example project's AWS scripts and templates.
- Keep API and auth logs selective. Never log full request events, environment variables, credentials or private run fields, even in a test environment.

## Take from the template, adapted to this project

- npm workspaces for the monorepo; Node 24 baseline if compatible with the chosen Cloudflare and Vite versions at implementation time.
- Prettier style: UTF-8, LF, 2 spaces, single quotes, trailing commas, 100 columns, semicolons. No `.editorconfig` is needed.
- ESLint flat config with `@eslint/js`, `typescript-eslint`, `eslint-plugin-import-x`, `eslint-plugin-sonarjs`, `eslint-plugin-security` and `eslint-config-prettier`. Keep meaningful type-aware checks, including floating/misused promises, unsafe arguments and ignored error paths. Add React Hooks rules for the web and separate browser/Worker globals.
- TypeScript strict mode, isolated modules, unused checks, consistent casing, no implicit returns and no fallthrough. Choose module resolution per target: Vite/browser/Worker packages should not inherit the NestJS NodeNext output assumptions.
- Vitest and separate type checking. Test configuration should follow actual app boundaries when they exist.
- Husky pre-commit with lint-staged: format and lint changed files. Add a CI gate for format, lint, typecheck and tests when a Git repository and deployment workflow exist.
- `.gitignore` for dependencies, generated output, local Cloudflare state and secrets.
- Consider adapting the template's `local/require-to-error-in-catch` rule together with its `toError` helper once application code exists. The rule and helper must enter together.

## Do not copy from the template

- NestJS, TypeORM migration exceptions, SWC decorator/reflect-metadata setup and NodeNext `#` import aliases.
- The company GitLab CI, Argo/Sonar/Jira integration, `.claude` settings, origin `AGENTS.md`, release scripts and unrelated `.git-blame-ignore-revs` hashes.
- The template's `package.json` wholesale: dependency versions and scripts must match the real web/API packages when they are created.

This is a selection list, not a scaffolding instruction. Recheck current package versions and platform support when implementation starts.
