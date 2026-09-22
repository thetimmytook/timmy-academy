import { eq, inArray, lte, max, sql } from 'drizzle-orm';

import { runs, state, tokens } from '../db/schema';

import { BenchmarkRequestError } from './repository';
import { searchFilters } from './search-filters';

import type { Anchor, BenchmarkDatabase, Tuple } from './d1-query';
import type { RunSearchQuery } from '@timmy/contracts';

export const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
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
  constructor(
    private readonly db: BenchmarkDatabase,
    private readonly now: () => number,
  ) {}

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

    if (!row) throw new Error('Benchmark migrations have not been applied.');

    return { ...row, expires: this.now() + TOKEN_LIFETIME_MS };
  }

  async searchSnapshot(): Promise<Snapshot> {
    const snapshot = await this.snapshot();
    const now = this.now();
    const payload = JSON.stringify(snapshot);
    // Atomic upsert keeps the original absolute expiry for concurrent searches.
    // Reuse the live snapshot so browser Back/reload keeps its expanded group.
    const row = await this.db
      .insert(tokens)
      .values({
        token: `snapshot_${snapshot.revision}_${snapshot.watermark}`,
        expiresAt: snapshot.expires,
        payload,
      })
      .onConflictDoUpdate({
        target: tokens.token,
        set: {
          payload: sql`case when ${tokens.expiresAt} <= ${now} then ${payload} else ${tokens.payload} end`,
          expiresAt: sql`case when ${tokens.expiresAt} <= ${now} then ${snapshot.expires} else ${tokens.expiresAt} end`,
        },
      })
      .returning({ payload: tokens.payload })
      .get();

    if (!row) throw new Error('Could not establish a search snapshot.');

    return JSON.parse(row.payload) as Snapshot;
  }

  async assertFresh(snapshot: Snapshot, code: 'cursor_stale' | 'group_key_stale' = 'cursor_stale') {
    const current = await this.snapshot();

    if (current.revision !== snapshot.revision || this.now() >= snapshot.expires)
      throw new BenchmarkRequestError(code);
  }

  async read(token: string, binding: string, kind: 'cur' | 'hg'): Promise<Navigation> {
    const invalid = kind === 'cur' ? 'invalid_cursor' : 'group_key_stale';
    const stale = kind === 'cur' ? 'cursor_stale' : 'group_key_stale';

    if (!(kind === 'cur' ? /^cur_[a-f0-9]{32}$/ : /^hg_[a-f0-9]{32}$/).test(token))
      throw new BenchmarkRequestError(invalid);

    const row = await this.db
      .select({ payload: tokens.payload })
      .from(tokens)
      .where(eq(tokens.token, token))
      .get();

    if (!row) throw new BenchmarkRequestError(stale);

    const navigation = JSON.parse(row.payload) as Navigation;

    if (navigation.binding !== binding) throw new BenchmarkRequestError(invalid);

    await this.assertFresh(navigation.snapshot, stale);

    return navigation;
  }

  async save(kind: 'cur' | 'hg', navigation: Navigation) {
    const token = `${kind}_${crypto.randomUUID().replaceAll('-', '')}`;

    await this.db
      .insert(tokens)
      .values({
        token,
        expiresAt: navigation.snapshot.expires,
        payload: JSON.stringify(navigation),
      })
      .run();

    return token;
  }

  async saveGroups(navigations: Navigation[]) {
    const keys = await Promise.all(
      navigations.map(async navigation => {
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(navigation)),
        );
        const hex = Array.from(new Uint8Array(digest), byte =>
          byte.toString(16).padStart(2, '0'),
        ).join('');

        return `hg_${hex.slice(0, 32)}`;
      }),
    );
    // Three bound parameters per row; stay within D1's 100-parameter limit.
    for (let start = 0; start < navigations.length; start += 30) {
      const values = navigations.slice(start, start + 30).map((navigation, index) => ({
        token: keys.at(start + index)!,
        expiresAt: navigation.snapshot.expires,
        payload: JSON.stringify(navigation),
      }));

      await this.db.insert(tokens).values(values).onConflictDoNothing().run();
    }

    return keys;
  }

  async cleanExpired() {
    const expired = this.db
      .select({ token: tokens.token })
      .from(tokens)
      .where(lte(tokens.expiresAt, this.now()))
      .limit(500);

    await this.db.delete(tokens).where(inArray(tokens.token, expired)).run();
  }
}
export function groupBinding(query: RunSearchQuery) {
  return JSON.stringify([searchFilters(query), query.sort]);
}
export function cursorBinding(query: RunSearchQuery) {
  return JSON.stringify([groupBinding(query), query.view, query.group_key ?? null, query.limit]);
}
