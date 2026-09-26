import { eq, max, sql } from 'drizzle-orm';

import { TOKEN_LIFETIME_MS } from '../config';
import { runs, state } from '../db/schema';

import { BenchmarkCursor } from './benchmark-cursor';
import { BenchmarkRequestError } from './repository';
import { searchFilters } from './search-filters';

import type { Anchor, BenchmarkDatabase, Tuple } from './d1-query';
import type { RunSearchQuery } from '@timmy/contracts';

export interface Snapshot {
  watermark: number;
  revision: number;
  expires: number;
}
export interface Navigation {
  snapshot: Snapshot;
  binding: string;
  hardware?: Tuple;
  after?: Anchor;
}
export class D1Navigation {
  private readonly codec;
  constructor(
    private readonly db: BenchmarkDatabase,
    secret: string | undefined,
  ) {
    this.codec = new BenchmarkCursor(secret);
  }

  async snapshot(): Promise<Snapshot> {
    const watermark = this.db.select({ value: max(runs.sequence) }).from(runs);
    const row = await this.db
      .select({
        revision: state.revision,
        watermark: sql<number>`coalesce((${watermark}), 0)`.mapWith(Number),
      })
      .from(state)
      .where(eq(state.id, 1))
      .get();

    if (!row) {
      throw new Error('Benchmark migrations have not been applied.');
    }

    return { ...row, expires: Date.now() + TOKEN_LIFETIME_MS };
  }

  async assertFresh(
    snapshot: Snapshot,
    code: 'cursor_stale' | 'group_key_stale' = 'cursor_stale',
  ): Promise<void> {
    const current = await this.snapshot();

    if (current.revision !== snapshot.revision || Date.now() >= snapshot.expires) {
      throw new BenchmarkRequestError(code);
    }
  }

  async read(token: string, binding: string, kind: 'cur' | 'hg'): Promise<Navigation> {
    const navigation = await this.codec.verify(token, binding, kind);
    await this.assertFresh(
      navigation.snapshot,
      kind === 'cur' ? 'cursor_stale' : 'group_key_stale',
    );

    return navigation;
  }

  save(kind: 'cur' | 'hg', navigation: Navigation): Promise<string> {
    return this.codec.sign(kind, navigation);
  }

  saveGroups(navigations: Navigation[]): Promise<string[]> {
    return Promise.all(navigations.map(navigation => this.save('hg', navigation)));
  }
}

export function groupBinding(query: RunSearchQuery): string {
  return JSON.stringify([searchFilters(query), query.sort]);
}

export function cursorBinding(query: RunSearchQuery): string {
  return JSON.stringify([groupBinding(query), query.view, query.group_key ?? null, query.limit]);
}
