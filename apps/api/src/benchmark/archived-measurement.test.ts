import { describe, expect, it } from 'vitest';

import { projectArchivedMeasurement, archivedMeasurementSchema } from './archived-measurement';
import { createSyntheticRuns } from './fixtures';

describe('archived measurement allowlist', () => {
  it('retains individual measurements while removing all source and user metadata', () => {
    const run = {
      ...createSyntheticRuns()[0]!.detail,
      author: { display_name: 'Private author', avatar_url: 'https://example.com/avatar.png' },
      accountId: 'private-account',
      client_run_id: 'private-client',
      issuer: 'private-issuer',
      subject: 'private-subject',
      request_fingerprint: 'private-fingerprint',
      submitted_at: '2026-09-26T12:00:00Z',
      published_at: '2026-09-26T12:30:00Z',
    };
    const archived = projectArchivedMeasurement(run);
    expect(archived).toEqual({
      hardware: run.hardware,
      conditions: run.conditions,
      capture: run.capture,
      metrics: run.metrics,
      settings: run.settings,
    });
    expect(Object.keys(archived).sort((a, b) => a.localeCompare(b))).toEqual([
      'capture',
      'conditions',
      'hardware',
      'metrics',
      'settings',
    ]);

    for (const field of [
      'public_run_id',
      'url',
      'captured_day',
      'author',
      'accountId',
      'client_run_id',
      'issuer',
      'subject',
      'request_fingerprint',
      'submitted_at',
      'published_at',
    ]) {
      expect(archivedMeasurementSchema.safeParse({ ...archived, [field]: 'private' }).success).toBe(
        false,
      );
    }
  });
  it('rejects unexpected nested fields rather than retaining them', () => {
    const run = createSyntheticRuns()[0]!.detail;
    expect(() =>
      projectArchivedMeasurement({
        ...run,
        hardware: { ...run.hardware, serial_number: 'private' },
      } as typeof run),
    ).toThrow();
  });
});
