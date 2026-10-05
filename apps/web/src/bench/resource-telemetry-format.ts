import { number, words } from './format';

import type { ResourceMetric, ResourceTelemetrySummary } from '@timmy/contracts';

const BYTES_PER_GIB = 2 ** 30;
export const NEAR_FULL_VRAM_PERCENT = 95;
const coverageFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 });

const reasonLabels: Record<ResourceMetric['reason_codes'][number], string> = {
  not_collected: 'Not collected',
  counter_unavailable: 'Counter unavailable',
  window_unavailable: 'Capture window unavailable',
  summary_unavailable: 'Summary unavailable',
  collector_unavailable: 'Collector unavailable',
  active_adapter_unknown: 'Active GPU adapter unknown',
  multiple_active_adapters: 'Multiple active GPU adapters',
  linked_adapter_unsupported: 'Linked GPU adapters unsupported',
  memory_architecture_unknown: 'GPU memory architecture unknown',
  partial_coverage: 'Incomplete capture coverage',
  pagefile_management_unknown: 'Automatic pagefile management unknown',
};
const reasonDescriptions = new Map(Object.entries(reasonLabels));

export function resourceValue(value: number | null, unit: ResourceMetric['unit']): string {
  if (value === null) {
    return 'Unavailable';
  }

  if (unit === 'bytes') {
    return `${number(value / BYTES_PER_GIB)} GiB`;
  }

  return unit === 'percent' ? `${number(value)}%` : number(value);
}

export function resourceCoverage(value: number): string {
  return `${coverageFormat.format(value * 100)}%`;
}

export function resourceReasons(reasons: ResourceMetric['reason_codes']): string {
  return reasons.map(reason => reasonDescriptions.get(reason)!).join(' · ');
}

export function pagefilePolicy(value: boolean | null): string {
  if (value === null) {
    return 'Unknown';
  }

  return words(value ? 'enabled' : 'disabled');
}

export function gpuSelection(gpu: ResourceTelemetrySummary['gpu']): string {
  if (gpu.selection_status === 'unknown') {
    return 'Unknown';
  }

  return gpu.selection_method === 'tarkov_graphics_activity'
    ? 'Tarkov graphics activity'
    : 'Single hardware adapter';
}

export function isNearFullVram(gpu: ResourceTelemetrySummary['gpu']): boolean {
  const capacity = gpu.dedicated_vram_capacity.value;
  const peak = gpu.dedicated_memory_used.maximum;

  return (
    gpu.memory_architecture === 'discrete' &&
    capacity !== null &&
    capacity > 0 &&
    peak !== null &&
    peak >= (capacity * NEAR_FULL_VRAM_PERCENT) / 100
  );
}
