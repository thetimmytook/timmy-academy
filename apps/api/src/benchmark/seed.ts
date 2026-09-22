import { createSyntheticRuns } from './fixtures';
import { projectDetail } from './projection';

// Stable, conspicuously fictional IDs. Never rewrite an existing row, including
// a hidden/deleted seed row: rerunning seed must not republish it.
export function seedRows() {
  const rows = createSyntheticRuns().map((run, index) => {
    const publicId = `br_test_${String(index + 1).padStart(2, '0')}`;

    return {
      ...run,
      visibility: 'published',
      detail: { ...projectDetail(run), public_run_id: publicId, url: `/bench/runs/${publicId}` },
    };
  });
  const first = rows[0];

  if (!first) {
    throw new Error('Missing seed fixture.');
  }

  for (const visibility of ['hidden', 'deleted']) {
    const publicId = `br_test_${visibility}`;
    rows.push({
      ...structuredClone(first),
      visibility,
      detail: {
        ...structuredClone(first.detail),
        public_run_id: publicId,
        url: `/bench/runs/${publicId}`,
      },
    });
  }

  return rows;
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function seedStatements() {
  return seedRows().map(
    run =>
      `INSERT INTO benchmark_runs(public_id, contributor_key, published_at, visibility, detail) VALUES (${[
        run.detail.public_run_id,
        run.contributor,
        run.publishedAt,
        run.visibility,
        JSON.stringify(run.detail),
      ]
        .map(quote)
        .join(', ')}) ON CONFLICT(public_id) DO NOTHING;`,
  );
}
