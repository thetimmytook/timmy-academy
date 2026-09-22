import type { FilterOptions, PublicRunDetail } from '@timmy/contracts';

export function namedOptions(values: { id: string; name: string }[]) {
  return [
    ...new Map(values.map(value => [value.id, { id: value.id, name: value.name }])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// Consume the same public projection as detail. Never consult the private catalog.
export function publicFilterOptions(runs: PublicRunDetail[]): FilterOptions {
  const resolutions = runs.flatMap(run =>
    run.conditions.game_resolution ? [run.conditions.game_resolution] : [],
  );
  return {
    cpus: namedOptions(runs.map(run => run.hardware.cpu)),
    gpus: namedOptions(runs.map(run => run.hardware.gpu)),
    ram_gb: [...new Set(runs.map(run => run.hardware.ram_gb))].sort((a, b) => a - b),
    maps: namedOptions(runs.map(run => run.conditions.map)),
    game_resolutions: [
      ...new Map(resolutions.map(value => [`${value.width}x${value.height}`, value])).values(),
    ].sort((a, b) => a.width - b.width || a.height - b.height),
    game_versions: [
      ...new Set(
        runs.flatMap(run => (run.conditions.game_version ? [run.conditions.game_version] : [])),
      ),
    ].sort((a, b) => a.localeCompare(b)),
  };
}
