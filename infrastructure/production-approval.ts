interface DeploymentEnvironment {
  id: number;
  protection_rules: { type: string; reviewers?: unknown[] }[];
}

interface DeploymentReview {
  state: string;
  environments: { id: number }[];
}

async function githubGet(path: string): Promise<unknown> {
  const token = process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const api = process.env.GITHUB_API_URL;

  if (!token || !repository || !api) {
    throw new Error('GitHub Actions credentials are required to verify production approval.');
  }

  const response = await fetch(`${api}/repos/${repository}/${path}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Cannot verify production approval (GitHub HTTP ${response.status}).`);
  }

  return response.json();
}

export async function requireProductionReviewers(): Promise<number> {
  const environment = (await githubGet('environments/production')) as DeploymentEnvironment;
  const isProtected =
    Number.isInteger(environment.id) &&
    environment.protection_rules.some(
      rule => rule.type === 'required_reviewers' && (rule.reviewers?.length ?? 0) > 0,
    );

  if (!isProtected) {
    throw new Error('Configure Required reviewers on the production Environment before deploying.');
  }

  return environment.id;
}

export async function checkProductionApproval(): Promise<void> {
  const environmentId = await requireProductionReviewers();

  const runId = process.env.GITHUB_RUN_ID;

  if (!runId) {
    throw new Error('A workflow run is required for production approval.');
  }

  const reviews = (await githubGet(`actions/runs/${runId}/approvals`)) as DeploymentReview[];
  const isApproved = reviews.some(
    review =>
      review.state === 'approved' && review.environments.some(value => value.id === environmentId),
  );

  if (!isApproved) {
    throw new Error('This workflow run has no manual approval for the production Environment.');
  }
}

if (import.meta.main) {
  await requireProductionReviewers();
}
