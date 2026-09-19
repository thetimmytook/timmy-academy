# Infrastructure

`wrangler.jsonc` defines two Cloudflare Workers deployments:

| Environment | Worker                     | Custom domain           | Trigger                                 |
| ----------- | -------------------------- | ----------------------- | --------------------------------------- |
| Staging     | `timmy-academy-staging`    | `staging.timmy.academy` | Successful checks on a push to `master` |
| Production  | `timmy-academy-production` | `timmy.academy`         | Manual GitHub Actions run from `master` |

Each deployment includes the Vite build from `apps/web/dist` and the Hono Worker from `apps/api`.
Cloudflare serves static files and SPA navigation without invoking the Worker script. Only `/api/*`
invokes the Worker. The web app calls the API on the same origin. The two Worker names and domain
bindings keep staging and production separate; future data and secret bindings must also be
configured separately for each environment. See `design/tooling-selection.md` for the routing decision.

## GitHub Actions setup

The repository's **Repository secrets** must contain `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. The Cloudflare account token needs Workers Admin for the first creation of
these Workers and Workers Routes Write for the `timmy.academy` zone. Once both Workers and custom
domains exist, replace it with a narrower deployment token if practical. Never put a token value in
this repository or a workflow log.

`.github/workflows/deploy.yml` checks pull requests to `master`. A push to `master` runs the same
checks and deploys staging on success. To deploy production, open **Actions → Check and deploy →
Run workflow**, select `master`, and run it. The manual run checks the selected commit before
deployment. The workflow uses Repository secrets and does not depend on GitHub Environments, which
may be unavailable for a private repository on the current GitHub plan.

The first deployment creates the Worker and attaches its custom domain. Cloudflare manages the DNS
record and TLS certificate for the custom domain. Before the production run, confirm that
`timmy.academy` has no conflicting CNAME record and that replacing any current site at the apex is
intentional. The staging hostname must also have no conflicting CNAME.

From the repository root, `npm run deploy:staging` and `npm run deploy:production` perform the same
build and deploy locally if Wrangler is authenticated. They are not required for GitHub Actions.
