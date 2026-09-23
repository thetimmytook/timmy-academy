import { describe, expect, it } from 'vitest';

import { NavigationToken } from './navigation-token';

import type { Navigation } from './d1-navigation';

const secret = 'fixture-signing-secret-not-for-deployment';
const navigation: Navigation = {
  snapshot: { watermark: 20, revision: 3, expires: 1800000 },
  binding: 'filters-sort-limit',
  after: ['2026-09-23', '2026-09-23T10:00:00Z', 'br_example'],
};

describe('signed client navigation', () => {
  it('round-trips across independent instances without a registry', async () => {
    const token = await new NavigationToken(secret).sign('cur', navigation);
    expect(await new NavigationToken(secret).verify(token, navigation.binding, 'cur')).toEqual(
      navigation,
    );
    expect(token.length).toBeLessThan(1024);
  });

  it('authenticates cursor kind, filters, snapshot, position and signing environment', async () => {
    const codec = new NavigationToken(secret);
    const token = await codec.sign('cur', navigation);
    await expect(codec.verify(token, 'changed-filters', 'cur')).rejects.toMatchObject({
      code: 'invalid_cursor',
    });
    await expect(
      new NavigationToken('another-environment').verify(token, navigation.binding, 'cur'),
    ).rejects.toMatchObject({ code: 'invalid_cursor' });
    await expect(
      codec.verify(token.replace('cur_', 'hg_'), navigation.binding, 'hg'),
    ).rejects.toMatchObject({ code: 'group_key_stale' });
    const bytes = Uint8Array.from(
      atob(token.slice(4).replaceAll('-', '+').replaceAll('_', '/')),
      char => char.charCodeAt(0),
    );
    bytes[10] = bytes[10]! ^ 1;
    const forged =
      'cur_' +
      btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    await expect(codec.verify(forged, navigation.binding, 'cur')).rejects.toMatchObject({
      code: 'invalid_cursor',
    });
  });

  it.each(['cur_bad', 'cur_' + 'a'.repeat(5000), 'cur_$$$', 'cur_'])(
    'rejects malformed or oversized tokens',
    async token => {
      await expect(
        new NavigationToken(secret).verify(token, navigation.binding, 'cur'),
      ).rejects.toMatchObject({ code: 'invalid_cursor' });
    },
  );

  it('marks old database-backed links stale and fails explicitly without configuration', async () => {
    await expect(
      new NavigationToken(secret).verify('cur_' + 'a'.repeat(32), navigation.binding, 'cur'),
    ).rejects.toMatchObject({ code: 'cursor_stale' });
    await expect(new NavigationToken(undefined).sign('cur', navigation)).rejects.toThrow(
      'not configured',
    );
  });

  it('uses deterministic group keys for the same client snapshot', async () => {
    const group = {
      snapshot: navigation.snapshot,
      binding: navigation.binding,
      hardware: ['cpu', 'gpu', 32] as [string, string, number],
    };
    const first = await new NavigationToken(secret).sign('hg', group);
    expect(await new NavigationToken(secret).sign('hg', group)).toBe(first);
    expect(await new NavigationToken(secret).verify(first, group.binding, 'hg')).toEqual(group);
    const decoded = await new NavigationToken(secret).verify(first, group.binding, 'hg');
    expect(await new NavigationToken(secret).sign('hg', decoded)).toBe(first);
  });
});
