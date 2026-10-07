import { number, words } from './format';

import type {
  GraphicsUtilizationSource,
  ResourceMetric,
  ResourceTelemetrySummary,
} from '@timmy/contracts';

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

type GraphicsUtilizationDisplay = Readonly<{ label: string; description: string }>;
const graphicsUtilizationDisplays = {
  pdh_gpu_engine_3d_busiest_engine: {
    label: 'Windows 3D utilization',
    description: 'Windows reports the busiest 3D engine on the selected adapter.',
  },
  nvapi_gpu_graphics_utilization: {
    label: 'Vendor GPU graphics load',
    description: 'NVAPI reports graphics-domain busy time over the trailing one second.',
  },
  adlx_gpu_usage: {
    label: 'Vendor GPU graphics load',
    description: 'ADLX reports GPUUsage; its averaging period is not specified.',
  },
} satisfies Record<GraphicsUtilizationSource, GraphicsUtilizationDisplay>;

export function graphicsUtilizationDisplay(
  source: GraphicsUtilizationSource,
): GraphicsUtilizationDisplay {
  // The source is the closed union validated by the shared contract.
  // eslint-disable-next-line security/detect-object-injection
  return graphicsUtilizationDisplays[source];
}

export const GRAPHICS_UTILIZATION_CAVEAT =
  'These APIs define percentages differently; do not treat their values as mathematically equivalent. A load percentage alone does not establish the cause of FPS drops.';

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
