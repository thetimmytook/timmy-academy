# Timmy Academy

Minimal npm workspace scaffold for the future Academy site and benchmark API.

## Local development

Use Node.js 24 and npm. From the repository root:

```sh
npm ci
npm run dev
```

In VS Code, press **Ctrl+Shift+B** or run **Tasks: Run Task → Academy: dev** to start API, web,
and the contracts watcher in separate terminals. The task builds contracts first and closes that
preparation terminal. Contract changes are rebuilt automatically.

Open `http://127.0.0.1:5173`. The web app proxies `/api` to the local Cloudflare Worker on port 8787. The only API route is `GET /api/bench/v1/health` and returns `{ "status": "ok" }`. `dev` also
watches the shared contracts package. Use `npm run dev:web` or `npm run dev:api` for one app.

## Checks

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run test:watch` runs Vitest in watch mode. Husky installs a pre-commit hook during `npm ci`;
lint-staged formats and lints staged source files. No CI/CD or deployment is configured yet.
