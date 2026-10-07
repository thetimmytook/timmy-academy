import { css } from '../../styled-system/css';
import { panel } from '../../styled-system/recipes';
import { DefinitionList } from '../elements/DefinitionList';
import { Message } from '../elements/Message';

import { number, words } from './format';
import {
  gpuSelection,
  graphicsUtilizationDisplay,
  GRAPHICS_UTILIZATION_CAVEAT,
  isNearFullVram,
  NEAR_FULL_VRAM_PERCENT,
  pagefilePolicy,
  resourceReasons,
  resourceValue,
} from './resource-telemetry-format';
import { ResourceMetricTable } from './ResourceMetricTable';
import { muted, stack } from './styles';

import type { ResourceTelemetry as TelemetryData } from '@timmy/contracts';
import type { JSX } from 'react';

const heading = css({ textStyle: 'h3' });
const disclosure = css({ cursor: 'pointer', fontWeight: 'semibold', mb: '3' });
const capacities = css({
  display: 'grid',
  gap: '5',
  gridTemplateColumns: { base: 'minmax(0, 1fr)', tablet: 'repeat(2, minmax(0, 1fr))' },
});

export function ResourceTelemetry({
  telemetry,
}: Readonly<{ telemetry: TelemetryData }>): JSX.Element {
  return (
    <section aria-label="Capture resources" className={`${panel()} ${stack}`}>
      <div>
        <h2 className={css({ textStyle: 'h2' })}>Capture resources</h2>
        <p className={muted}>{words(telemetry.status)}</p>
      </div>
      {telemetry.status === 'not_collected' ? (
        <Message>Resource telemetry was not collected for this capture.</Message>
      ) : (
        <>
          <p className={muted}>
            Statistics and peaks cover this capture only. CPU, RAM, pagefile and commit describe the
            whole system, including other applications. GPU measurements describe the whole selected
            adapter, including other applications. Memory is shown in GiB (1 GiB = 1,073,741,824
            bytes).
          </p>
          {telemetry.status === 'unavailable' && (
            <Message>Resource collection produced no usable measurements for this capture.</Message>
          )}
          {telemetry.warnings.length > 0 && (
            <Message>{resourceReasons(telemetry.warnings)}</Message>
          )}
          <details>
            <summary className={disclosure}>Capture window and coverage</summary>
            <DefinitionList
              values={[
                ['Requested duration', `${number(telemetry.window.requested_duration_sec)} s`],
                [
                  'Valid frame intervals',
                  telemetry.window.duration_sec === null
                    ? 'Unavailable'
                    : `${number(telemetry.window.duration_sec)} s`,
                ],
                ['Target sampling interval', `${number(telemetry.window.target_interval_sec)} s`],
                ['Expected samples', number(telemetry.window.expected_sample_count)],
                [
                  'Alignment',
                  telemetry.window.alignment === 'unknown'
                    ? 'Unknown'
                    : 'PresentMon QPC valid frame intervals',
                ],
              ]}
            />
            <p className={`${muted} ${css({ mt: '3' })}`}>
              Coverage is the fraction of valid frame intervals supported by each measurement. Gauge
              samples, including vendor GPU load, cover at most one second each; Windows utilization
              counters cover their measured interval. Gaps are excluded. Partial coverage describes
              less of the capture; unavailable values have no valid measurements. The interval union
              can be shorter than the summed FPS frametimes.
            </p>
          </details>
          <section className={stack}>
            <h3 className={heading}>CPU</h3>
            <ResourceMetricTable
              caption="CPU measurements"
              rows={[['Total utilization', telemetry.cpu.total_utilization]]}
            />
            <details>
              <summary className={disclosure}>
                Logical processors ({number(telemetry.cpu.logical_processors.length)})
              </summary>
              {telemetry.cpu.logical_processors.length > 0 ? (
                <ResourceMetricTable
                  caption="Logical processor measurements"
                  rows={telemetry.cpu.logical_processors.map(processor => [
                    `Group ${processor.group} · Processor ${processor.index}`,
                    processor.utilization,
                  ])}
                />
              ) : (
                <p className={muted}>No logical processor measurements available.</p>
              )}
            </details>
          </section>
          <GpuTelemetry gpu={telemetry.gpu} />
          <section className={stack}>
            <h3 className={heading}>Physical RAM</h3>
            <div className={capacities}>
              <Capacity label="Installed RAM" capacity={telemetry.ram.installed_capacity} />
              <Capacity label="OS usable RAM" capacity={telemetry.ram.os_usable_capacity} />
            </div>
            <ResourceMetricTable
              caption="Physical RAM measurements"
              rows={[
                ['Physical used', telemetry.ram.physical_used],
                ['Physical available', telemetry.ram.physical_available],
              ]}
            />
          </section>
          <PagefileTelemetry pagefile={telemetry.pagefile} />
          <section className={stack}>
            <h3 className={heading}>Commit</h3>
            <p className={muted}>
              Commit is memory Windows has promised to back. Its limit and remaining headroom are
              separate from physical RAM and pagefile allocation or use.
            </p>
            <ResourceMetricTable
              caption="Commit measurements"
              rows={[
                ['Commit used', telemetry.commit.used],
                ['Commit limit', telemetry.commit.limit],
                ['Commit headroom', telemetry.commit.headroom],
              ]}
            />
          </section>
        </>
      )}
    </section>
  );
}

function Capacity({
  label,
  capacity,
}: Readonly<{
  label: string;
  capacity: TelemetryData['ram']['installed_capacity'];
}>): JSX.Element {
  return (
    <div>
      <DefinitionList values={[[label, resourceValue(capacity.value, capacity.unit)]]} />
      {capacity.reason_codes.length > 0 && (
        <p className={muted}>{resourceReasons(capacity.reason_codes)}</p>
      )}
    </div>
  );
}

function GpuTelemetry({ gpu }: Readonly<{ gpu: TelemetryData['gpu'] }>): JSX.Element {
  const graphics = graphicsUtilizationDisplay(gpu.graphics_utilization.source);

  return (
    <section className={stack}>
      <h3 className={heading}>GPU</h3>
      <DefinitionList
        values={[
          ['Selected adapter', gpu.adapter_name ?? 'Unknown'],
          ['Adapter selection', gpuSelection(gpu)],
          ['Memory architecture', words(gpu.memory_architecture)],
          ['Graphics load source', gpu.graphics_utilization.source],
          ['GPU scope', `Whole adapter (${gpu.graphics_utilization.scope})`],
        ]}
      />
      {gpu.memory_architecture === 'unified' ? (
        <Message>
          Unified memory (UMA): this adapter has no discrete VRAM. Dedicated and shared usage are
          shown as reported by Windows.
        </Message>
      ) : (
        <Capacity label="Dedicated VRAM capacity" capacity={gpu.dedicated_vram_capacity} />
      )}
      <p className={muted}>
        Shared GPU memory uses system RAM. It is not additional dedicated VRAM. Adapter measurements
        are not per-game memory use.
      </p>
      <p className={muted}>
        {graphics.description} {GRAPHICS_UTILIZATION_CAVEAT}
      </p>
      {isNearFullVram(gpu) && (
        <Message tone="warning">
          Peak dedicated memory reached at least {NEAR_FULL_VRAM_PERCENT}% of VRAM capacity during
          this capture. This may indicate a memory limit; it does not establish the cause of FPS
          drops. Try lower texture quality in a repeatable A/B test and compare captures.
        </Message>
      )}
      <ResourceMetricTable
        caption="GPU measurements"
        rows={[
          [graphics.label, gpu.graphics_utilization],
          ['Dedicated memory used', gpu.dedicated_memory_used],
          ['Shared memory used', gpu.shared_memory_used],
        ]}
      />
    </section>
  );
}

function PagefileTelemetry({
  pagefile,
}: Readonly<{ pagefile: TelemetryData['pagefile'] }>): JSX.Element {
  return (
    <section className={stack}>
      <h3 className={heading}>Pagefile</h3>
      <DefinitionList
        values={[
          ['Automatic management (system policy)', pagefilePolicy(pagefile.automatic_management)],
        ]}
      />
      <p className={muted}>
        This is the global Windows policy, not the management mode of each file. Allocated is the
        current actual size; it can change during a capture. Used is separate from allocation. File
        count can also change, so its average may be fractional.
      </p>
      <ResourceMetricTable
        caption="Pagefile measurements"
        rows={[
          ['File count', pagefile.file_count],
          ['Allocated', pagefile.allocated],
          ['Used', pagefile.used],
        ]}
      />
      <details>
        <summary className={disclosure}>
          Individual pagefiles ({number(pagefile.files.length)})
        </summary>
        {pagefile.files.length > 0 ? (
          pagefile.files.map(file => (
            <ResourceMetricTable
              key={file.index}
              caption={`Pagefile ${file.index} · ${file.drive_media_type === 'unknown' ? 'Unknown media' : file.drive_media_type}`}
              rows={[
                [`Allocated`, file.allocated],
                [`Used`, file.used],
              ]}
            />
          ))
        ) : (
          <p className={muted}>
            No individual pagefile measurements recorded. See the file count for whether pagefiles
            were present.
          </p>
        )}
      </details>
    </section>
  );
}
