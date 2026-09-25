import { BenchmarkRequestError } from './repository';

import type { CohortQuery, Hardware } from '@timmy/contracts';

const cleanName = (value: string): string => value.trim().replace(/\s+/g, ' ');

async function resolveModel(kind: 'cpu' | 'gpu', rawName: string): Promise<Hardware['cpu']> {
  const name = cleanName(rawName);

  if (!name) {
    throw new BenchmarkRequestError('invalid_input');
  }

  const key = name.toLowerCase();

  // IDs depend on the full comparison name. No lossy slugging, suffix stripping or fuzzy match.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(
    '',
  );

  return { id: kind + '-' + hash, name };
}

export async function normalizeHardware(input: CohortQuery['hardware']): Promise<Hardware> {
  const [cpu, gpu] = await Promise.all([
    resolveModel('cpu', input.cpu_name),
    resolveModel('gpu', input.gpu_name),
  ]);

  return { cpu, gpu, ram_gb: input.ram_gb };
}
