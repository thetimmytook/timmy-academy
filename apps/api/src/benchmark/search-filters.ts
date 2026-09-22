import type { BenchmarkFilters, RunSearchQuery } from '@timmy/contracts';

export function searchFilters(query: RunSearchQuery): BenchmarkFilters {
  return {
    cpu: query.cpu ?? null,
    gpu: query.gpu ?? null,
    ram_gb: query.ram_gb ?? null,
    map: query.map ?? null,
    execution: query.execution ?? null,
    game_width: query.game_width ?? null,
    game_height: query.game_height ?? null,
    game_version: query.game_version ?? null,
  };
}
