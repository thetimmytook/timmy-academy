import { and, eq, notExists, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { accountIdentities, accounts } from '../db/schema';

import type { D1Database } from '@cloudflare/workers-types';

/** Private verifier output. Callers must authenticate this pair before resolving it. */
export interface VerifiedIdentity {
  issuer: string;
  subject: string;
}

export class D1AccountRepository {
  private readonly db;

  constructor(database: D1Database) {
    // Use the primary so an existing mapping cannot be missed by a stale replica.
    this.db = drizzle(database);
  }

  async findOrCreateAccount(identity: VerifiedIdentity): Promise<string> {
    const { issuer, subject } = identity;

    if (!issuer || !subject) {
      throw new Error('A verified issuer and subject are required.');
    }

    const existing = this.db
      .select({ accountId: accountIdentities.accountId })
      .from(accountIdentities)
      .where(and(eq(accountIdentities.issuer, issuer), eq(accountIdentities.subject, subject)));
    const accountId = crypto.randomUUID();

    // D1 batch is a transaction: concurrent callers see the winning mapping,
    // and a failed identity insert rolls back the account insert as well.
    // Both inserts are conditional; never ignore a conflict after creating an account.
    const [, , mappings] = await this.db.batch([
      this.db.insert(accounts).select(sql`SELECT ${accountId} WHERE ${notExists(existing)}`),
      this.db
        .insert(accountIdentities)
        .select(sql`SELECT ${issuer}, ${subject}, ${accountId} WHERE ${notExists(existing)}`),
      existing,
    ]);
    const mapping = mappings[0];

    if (!mapping) {
      throw new Error('Account identity mapping is missing.');
    }

    return mapping.accountId;
  }
}
