import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { createSyntheticRuns } from '../../../api/src/benchmark/fixtures';
import { projectSummary } from '../../../api/src/benchmark/projection';

import { RunDetails } from './RunDetails';
import { RunList } from './RunList';

afterEach(cleanup);

it.each([true, false])('labels synthetic=%s in run lists and details', isSynthetic => {
  const run = createSyntheticRuns()[0]!;
  run.detail.is_synthetic = isSynthetic;
  render(
    <>
      <RunList runs={[projectSummary(run)]} />
      <RunDetails run={run.detail} />
    </>,
  );
  expect(screen.queryAllByText('Demo data')).toHaveLength(isSynthetic ? 2 : 0);
});
