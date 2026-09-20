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
