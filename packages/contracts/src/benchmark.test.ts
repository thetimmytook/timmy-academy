import { describe, expect, it } from 'vitest';

import {
  benchmarkErrorSchema,
  cohortQuerySchema,
  groupKeySchema,
  publicRunIdSchema,
  publicSettingsSchema,
  runSearchQuerySchema,
} from './benchmark';

describe('public benchmark runtime contracts', () => {
  it('parses defaults and exact numeric filters from HTTP strings', () => {
    expect(runSearchQuerySchema.parse({})).toEqual({
      view: 'groups',
      sort: 'captured_desc',
      limit: 20,
    });
    expect(
      runSearchQuerySchema.parse({
        ram_gb: '32',
        game_width: '2560',
        game_height: '1440',
        limit: '50',
      }),
    ).toMatchObject({ ram_gb: 32, game_width: 2560, game_height: 1440, limit: 50 });
  });
  it.each([
    { limit: '51' },
    { limit: '0' },
    { limit: '1.5' },
    { limit: '1e1' },
    { limit: '' },
    { ram_gb: 'NaN' },
    { ram_gb: '-32' },
    { game_width: '2560' },
    { game_height: '1440' },
    { game_width: '16385', game_height: '1440' },
    { execution: 'pve' },
    { sort: 'fps_desc' },
    { view: 'items' },
    { group_key: 'hg_abc' },
    { 'settings.graphics.dlss_mode': 'Off' },
    { cpu: 'Ryzen 7' },
  ])('rejects invalid or unsupported queries: %j', query => {
    expect(runSearchQuerySchema.safeParse(query).success).toBe(false);
  });
  it('accepts opaque tokens without decoding hardware or private identity', () => {
    expect(publicRunIdSchema.parse('br_8N4qP2vK')).toBe('br_8N4qP2vK');
    expect(groupKeySchema.parse('hg_L7q8')).toBe('hg_L7q8');
    expect(publicRunIdSchema.safeParse('user@example.test').success).toBe(false);
  });
  it('preserves missing settings and false toggles without defaults', () => {
    expect(publicSettingsSchema.parse({ postfx: { enabled: false } })).toEqual({
      postfx: { enabled: false },
    });
    expect(publicSettingsSchema.safeParse({}).success).toBe(false);
    expect(publicSettingsSchema.safeParse({ graphics: {} }).success).toBe(false);
  });
  it.each([
    { graphics: { texture_quality_code: 16 } },
    { graphics: { dlss_mode: 'C:/private/path' } },
    { graphics: { screen_mode: 1 } },
    { postfx: { enabled: true, brightness: 10 } },
    { graphics: { Display: 0 } },
    { game: { account_id: 'secret' } },
    { graphics: { resampling_factor: Infinity } },
  ])('rejects unapproved settings and unbounded values: %j', settings => {
    expect(publicSettingsSchema.safeParse(settings).success).toBe(false);
  });
  it('allows unknown required Position values but rejects raw captures and FPS', () => {
    const query = {
      hardware: { cpu_name: 'Ryzen 7 7800X3D', gpu_name: 'GeForce RTX 4070 SUPER', ram_gb: 32 },
      map: 'lighthouse',
      execution: 'bsg_servers',
      game_resolution: null,
      game_version: null,
    };
    expect(cohortQuerySchema.safeParse(query).success).toBe(true);

    for (const extra of [
      { average_fps: 100 },
      { raw_capture: [] },
      { client_run_id: 'private' },
      { hardware: { ...query.hardware, serial_number: 'private' } },
    ]) {
      expect(cohortQuerySchema.safeParse({ ...query, ...extra }).success).toBe(false);
    }
  });
  it('requires the flat shared error envelope', () => {
    expect(
      benchmarkErrorSchema.safeParse({
        code: 'not_found',
        message: 'Not found.',
        request_id: 'req_example',
      }).success,
    ).toBe(true);
    expect(
      benchmarkErrorSchema.safeParse({
        code: 'not_found',
        message: 'Not found.',
        request_id: 'req_example',
        stack: 'private',
      }).success,
    ).toBe(false);
  });
});
