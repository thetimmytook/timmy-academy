import type { PublicRunDetail } from '@timmy/contracts';

export interface StoredRun {
  detail: PublicRunDetail;
  contributor: string;
  publishedAt: string;
}
