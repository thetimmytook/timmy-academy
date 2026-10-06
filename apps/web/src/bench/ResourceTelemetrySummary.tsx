import { css } from '../../styled-system/css';
import { DefinitionList } from '../elements/DefinitionList';

import { words } from './format';
import { resourceCoverage, resourceReasons, resourceValue } from './resource-telemetry-format';
import { muted } from './styles';

import type { ResourceMetric, ResourceTelemetrySummary as SummaryData } from '@timmy/contracts';
import type { JSX } from 'react';

function summaryValue(
  metric: ResourceMetric,
  statistic: 'average' | 'minimum' | 'maximum',
): string {
  // The statistic key is a fixed union of approved contract fields.
  // eslint-disable-next-line security/detect-object-injection
  const value = resourceValue(metric[statistic], metric.unit);

  return metric.status === 'unavailable'
    ? value
    : `${value} · ${resourceCoverage(metric.coverage)} coverage`;
}

export function ResourceTelemetrySummary({
  telemetry,
}: Readonly<{ telemetry: SummaryData }>): JSX.Element {
  return (
    <details>
      <summary className={css({ cursor: 'pointer', fontWeight: 'semibold', mb: '3' })}>
        Resources · {words(telemetry.status)}
      </summary>
      {telemetry.status === 'not_collected' ? (
        <p className={muted}>Resource telemetry was not collected for this capture.</p>
      ) : (
        <>
          {telemetry.warnings.length > 0 && (
            <p className={muted}>{resourceReasons(telemetry.warnings)}</p>
          )}
          <p className={`${muted} ${css({ mb: '3' })}`}>
            Whole-system CPU, RAM and commit; whole-adapter GPU. Peaks and minimums cover this
            capture only. Memory is shown in GiB. Shared GPU memory is system RAM.
          </p>
          <DefinitionList
            values={[
              ['Selected GPU adapter', telemetry.gpu.adapter_name ?? 'Unknown'],
              ['CPU average', summaryValue(telemetry.cpu.total_utilization, 'average')],
              ['GPU graphics average', summaryValue(telemetry.gpu.graphics_utilization, 'average')],
              [
                'Dedicated VRAM capacity',
                telemetry.gpu.memory_architecture === 'unified'
                  ? 'Unified memory · no discrete VRAM'
                  : resourceValue(telemetry.gpu.dedicated_vram_capacity.value, 'bytes'),
              ],
              [
                'Peak dedicated memory',
                summaryValue(telemetry.gpu.dedicated_memory_used, 'maximum'),
              ],
              ['Peak shared memory', summaryValue(telemetry.gpu.shared_memory_used, 'maximum')],
              ['Minimum available RAM', summaryValue(telemetry.ram.physical_available, 'minimum')],
              ['Minimum commit headroom', summaryValue(telemetry.commit.headroom, 'minimum')],
            ]}
          />
        </>
      )}
    </details>
  );
}
