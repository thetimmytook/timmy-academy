import { z } from 'zod';

import { TOKEN_LIFETIME_MS } from './d1-navigation';
import { BenchmarkRequestError } from './repository';
import { SignedToken, encodeTokenBytes } from './signed-token';

import type { D1SubmissionRepository, SubmissionPage } from './d1-submission-repository';
import type { OwnerRunsQuery } from '@timmy/contracts';

const cursorSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('own'),
  binding: z.string(),
  revision: z.number().int().nonnegative(),
  expires: z.number().int().nonnegative(),
  after: z.strictObject({ submittedAt: z.iso.datetime(), sequence: z.number().int().positive() }),
});

export class OwnerSubmissionReader {
  private readonly codec;
  constructor(
    private readonly repository: D1SubmissionRepository,
    secret: string,
  ) {
    this.codec = new SignedToken(secret);
  }

  async list(
    accountId: string,
    query: OwnerRunsQuery,
  ): Promise<{ items: SubmissionPage['items']; next_cursor: string | null }> {
    const binding = encodeTokenBytes(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify([accountId, query.status, query.limit])),
        ),
      ),
    );
    const revision = await this.repository.revision();
    let cursor: z.infer<typeof cursorSchema> | undefined;

    if (query.cursor !== undefined) {
      try {
        cursor = cursorSchema.parse(await this.codec.verify('own', query.cursor));

        if (cursor.binding !== binding) {
          throw new Error('Cursor binding mismatch');
        }
      } catch {
        throw new BenchmarkRequestError('invalid_cursor');
      }
    }

    const snapshot = cursor ?? { revision, expires: Date.now() + TOKEN_LIFETIME_MS };
    this.assertFresh(snapshot, revision);
    const page = await this.repository.list(accountId, {
      status: query.status,
      limit: query.limit,
      ...(cursor ? { after: cursor.after } : {}),
    });
    const next_cursor = page.next
      ? await this.codec.sign(
          'own',
          cursorSchema.parse({
            version: 1,
            kind: 'own',
            binding,
            revision: snapshot.revision,
            expires: snapshot.expires,
            after: page.next,
          }),
        )
      : null;
    this.assertFresh(snapshot, await this.repository.revision());

    return { items: page.items, next_cursor };
  }

  private assertFresh(snapshot: { revision: number; expires: number }, revision: number): void {
    if (snapshot.revision !== revision || Date.now() >= snapshot.expires) {
      throw new BenchmarkRequestError('cursor_stale');
    }
  }
}
