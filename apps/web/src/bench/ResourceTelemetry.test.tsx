import { cleanup, render, screen, within } from '@testing-library/react';
import { resourceTelemetrySchema } from '@timmy/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createMissingResourceTelemetryFixture,
  createResourceTelemetryFixture,
  createUnavailableMetricFixture,
} from '../../../../packages/contracts/src/resource-telemetry.fixture';

import { ResourceTelemetry } from './ResourceTelemetry';
import { ResourceTelemetrySummary } from './ResourceTelemetrySummary';

import type { ResourceTelemetry as TelemetryData } from '@timmy/contracts';

const gib = 2 ** 30;
const cpuTable = 'CPU measurements';
const cpuTotal = 'Total utilization';
const gpuTable = 'GPU measurements';
const ramTable = 'Physical RAM measurements';
const ramAvailable = 'Physical available';
const pagefileTable = 'Pagefile measurements';
const zeroMemory = '0 GiB';
const nearFullHint = /Peak dedicated memory reached at least 95%/;

afterEach(cleanup);

function show(telemetry: TelemetryData): void {
  render(<ResourceTelemetry telemetry={resourceTelemetrySchema.parse(telemetry)} />);
}

function row(table: string, label: string): HTMLElement {
  const header = within(screen.getByRole('table', { name: table, hidden: true })).getByText(label, {
    exact: true,
  });

  return header.closest('tr')!;
}

describe('capture resources', () => {
  it('shows distinct capture statistics, capacities, scopes and units', () => {
    const telemetry = createResourceTelemetryFixture();
    Object.assign(telemetry.cpu.total_utilization, {
      average: 40,
      minimum: 20,
      maximum: 80,
      last: 30,
    });
    show(telemetry);
    expect(
      within(row(cpuTable, cpuTotal))
        .getAllByRole('cell')
        .map(cell => cell.textContent),
    ).toEqual(['40%', '20%', '80%', '30%', '100%120 samples · 120 s valid']);
    expect(screen.getByText('Installed RAM').nextElementSibling?.textContent).toBe('32 GiB');
    expect(screen.getByText('OS usable RAM').nextElementSibling?.textContent).toBe('31 GiB');
    expect(screen.getByText('Dedicated VRAM capacity').nextElementSibling?.textContent).toBe(
      '12 GiB',
    );
    expect(screen.getByText(/whole system, including other applications/)).toBeTruthy();
    expect(screen.getByText(/whole selected adapter, including other applications/)).toBeTruthy();
    expect(screen.getByText(/Shared GPU memory uses system RAM/)).toBeTruthy();
    expect(screen.getByText(/Commit is memory Windows has promised to back/)).toBeTruthy();
    expect(screen.getByText(/Coverage is the fraction of valid frame intervals/)).toBeTruthy();
    expect(screen.queryByText(nearFullHint)).toBeNull();
  });

  it.each(['not_collected', 'unavailable'] as const)(
    'does not present %s telemetry as measured zeros',
    status => {
      show(createMissingResourceTelemetryFixture(status));

      if (status === 'not_collected') {
        expect(
          screen.getByText('Resource telemetry was not collected for this capture.'),
        ).toBeTruthy();
        expect(screen.queryByRole('table')).toBeNull();
      } else {
        expect(
          screen.getByText(/Resource collection produced no usable measurements/),
        ).toBeTruthy();
        const cells = within(row(cpuTable, cpuTotal)).getAllByRole('cell');
        expect(cells[0]?.textContent).toBe('Unavailable');
        expect(cells[0]?.getAttribute('colspan')).toBe('4');
        expect(screen.getByText('Selected adapter').nextElementSibling?.textContent).toBe(
          'Unknown',
        );
      }

      expect(screen.queryAllByText(zeroMemory)).toHaveLength(0);
    },
  );

  it('keeps partial coverage, valid support and unavailable values distinct', () => {
    const telemetry = createResourceTelemetryFixture();
    telemetry.status = 'partial';
    Object.assign(telemetry.cpu.total_utilization, {
      status: 'partial',
      coverage: 0.75,
      valid_duration_sec: 90,
      valid_sample_count: 90,
      reason_codes: ['partial_coverage'],
    });
    telemetry.ram.physical_available = createUnavailableMetricFixture(
      telemetry.ram.physical_available,
      'collector_unavailable',
    );
    telemetry.warnings = ['partial_coverage', 'collector_unavailable'];
    show(telemetry);
    expect(row(cpuTable, cpuTotal).textContent).toContain('75%90 samples · 90 s valid');
    expect(row(cpuTable, cpuTotal).textContent).toContain('Incomplete capture coverage');
    expect(row(ramTable, ramAvailable).textContent).toContain('Unavailable');
    expect(row(ramTable, ramAvailable).textContent).not.toContain(zeroMemory);
  });

  it('does not round near-complete partial coverage to 100 percent', () => {
    const telemetry = createResourceTelemetryFixture();
    telemetry.status = 'partial';
    Object.assign(telemetry.cpu.total_utilization, {
      status: 'partial',
      coverage: 0.999998,
      valid_duration_sec: 119.99976,
      reason_codes: ['partial_coverage'],
    });
    telemetry.warnings = ['partial_coverage'];
    show(telemetry);
    expect(row(cpuTable, cpuTotal).textContent).toContain('99.9998%');
  });

  it('shows unknown automatic management without treating it as disabled', () => {
    const telemetry = createResourceTelemetryFixture();
    telemetry.status = 'partial';
    telemetry.pagefile.automatic_management = null;
    telemetry.warnings = ['pagefile_management_unknown'];
    show(telemetry);
    expect(
      screen.getByText('Automatic management (system policy)').nextElementSibling?.textContent,
    ).toBe('Unknown');
  });

  it.each([94.99, 95, 100])(
    'limits the cautious VRAM hint to a known discrete peak of %s percent',
    percent => {
      const telemetry = createResourceTelemetryFixture();
      telemetry.gpu.dedicated_memory_used.maximum =
        (telemetry.gpu.dedicated_vram_capacity.value! * percent) / 100;
      show(telemetry);
      expect(screen.queryByText(nearFullHint) !== null).toBe(percent >= 95);

      if (percent >= 95) {
        expect(screen.getByText(/does not establish the cause of FPS drops/)).toBeTruthy();
        expect(screen.getByText(/repeatable A\/B test/)).toBeTruthy();
      }
    },
  );

  it('shows UMA without interpreting zero physical VRAM as a full adapter', () => {
    const telemetry = createResourceTelemetryFixture();
    telemetry.gpu.memory_architecture = 'unified';
    telemetry.gpu.dedicated_vram_capacity = {
      ...telemetry.gpu.dedicated_vram_capacity,
      source: 'd3d12_unified_memory_no_discrete_vram',
      value: 0,
    };
    show(telemetry);
    expect(
      screen.getByText(/Unified memory \(UMA\): this adapter has no discrete VRAM/),
    ).toBeTruthy();
    expect(row(gpuTable, 'Shared memory used').textContent).toContain('1 GiB');
    expect(screen.queryByText(nearFullHint)).toBeNull();
    expect(screen.queryByText(zeroMemory)).toBeNull();
  });

  it('does not infer VRAM capacity from usage when the architecture is unknown', () => {
    const telemetry = createResourceTelemetryFixture();
    telemetry.status = 'partial';
    telemetry.gpu.memory_architecture = 'unknown';
    Object.assign(telemetry.gpu.dedicated_vram_capacity, {
      value: null,
      status: 'unavailable',
      reason_codes: ['memory_architecture_unknown'],
    });
    telemetry.warnings = ['memory_architecture_unknown'];
    show(telemetry);
    expect(screen.getByText('Dedicated VRAM capacity').nextElementSibling?.textContent).toBe(
      'Unavailable',
    );
    expect(row(gpuTable, 'Dedicated memory used').textContent).toContain('8 GiB');
    expect(screen.queryByText(nearFullHint)).toBeNull();
  });

  it('shows unknown adapter selection without inferring a GPU from the hardware card', () => {
    const telemetry = createMissingResourceTelemetryFixture('unavailable');
    show(telemetry);
    expect(screen.getByText('Adapter selection').nextElementSibling?.textContent).toBe('Unknown');
    expect(row(gpuTable, 'Graphics utilization').textContent).toContain(
      'Active GPU adapter unknown',
    );
    expect(screen.queryByText(nearFullHint)).toBeNull();
  });

  it('preserves minimum available RAM and commit headroom separately from usage and limits', () => {
    const telemetry = createResourceTelemetryFixture();
    telemetry.ram.physical_available.minimum = 3 * gib;
    telemetry.commit.headroom.minimum = 2 * gib;
    show(telemetry);
    expect(within(row(ramTable, ramAvailable)).getAllByRole('cell')[1]?.textContent).toBe('3 GiB');
    expect(
      within(row('Commit measurements', 'Commit headroom')).getAllByRole('cell')[1]?.textContent,
    ).toBe('2 GiB');
    expect(row('Commit measurements', 'Commit limit').textContent).toContain('54 GiB');
  });

  it('shows global policy, changing allocation and anonymous pagefile indices with media types', () => {
    const telemetry = createResourceTelemetryFixture();
    telemetry.pagefile.automatic_management = false;
    Object.assign(telemetry.pagefile.file_count, { average: 1.5, minimum: 1, maximum: 2, last: 2 });
    Object.assign(telemetry.pagefile.allocated, {
      average: 28 * gib,
      minimum: 24 * gib,
      maximum: 32 * gib,
      last: 32 * gib,
    });
    Object.assign(telemetry.pagefile.used, {
      average: 2.5 * gib,
      minimum: 2 * gib,
      maximum: 3 * gib,
      last: 3 * gib,
    });
    const file = structuredClone(telemetry.pagefile.files[0]!);
    file.index = 2;
    file.drive_media_type = 'HDD';

    for (const [metric, value] of [
      [file.allocated, 8 * gib],
      [file.used, gib],
    ] as const) {
      Object.assign(metric, {
        average: value,
        minimum: value,
        maximum: value,
        last: value,
        status: 'partial',
        coverage: 0.5,
        valid_duration_sec: 60,
        valid_sample_count: 60,
        reason_codes: ['partial_coverage'],
      });
    }

    telemetry.pagefile.files.push(file);
    show(telemetry);
    expect(
      screen.getByText('Automatic management (system policy)').nextElementSibling?.textContent,
    ).toBe('Disabled');
    expect(
      screen.getByText(/global Windows policy, not the management mode of each file/),
    ).toBeTruthy();
    expect(row(pagefileTable, 'File count').textContent).toContain('1.5');
    expect(row(pagefileTable, 'Allocated').textContent).toContain('28 GiB24 GiB32 GiB32 GiB');
    expect(screen.getByText('Pagefile 1 · SSD')).toBeTruthy();
    expect(screen.getByText('Pagefile 2 · HDD')).toBeTruthy();
    expect(screen.queryByText(/C:\\|D:\\|pagefile\.sys/)).toBeNull();
  });

  it('shows measured zeros for a system without pagefiles', () => {
    const telemetry = createResourceTelemetryFixture();
    telemetry.pagefile.files = [];

    for (const metric of [
      telemetry.pagefile.file_count,
      telemetry.pagefile.allocated,
      telemetry.pagefile.used,
    ]) {
      Object.assign(metric, { average: 0, minimum: 0, maximum: 0, last: 0 });
    }

    show(telemetry);
    expect(row(pagefileTable, 'File count').textContent).toContain('Available0000');
    expect(row(pagefileTable, 'Allocated').textContent).toContain(zeroMemory);
    expect(screen.getByText(/See the file count for whether pagefiles were present/)).toBeTruthy();
  });

  it('keeps all 512 logical processors identified by group and index inside a closed disclosure', () => {
    const telemetry = createResourceTelemetryFixture();
    const utilization = telemetry.cpu.logical_processors[0]!.utilization;
    telemetry.cpu.logical_processors = Array.from({ length: 512 }, (_, ordinal) => ({
      group: Math.floor(ordinal / 64),
      index: ordinal % 64,
      utilization,
    }));
    show(telemetry);
    expect(screen.getByText('Logical processors (512)').closest('details')?.open).toBe(false);
    expect(screen.getByText('Group 0 · Processor 0')).toBeTruthy();
    expect(screen.getByText('Group 7 · Processor 63')).toBeTruthy();
  });

  it('uses a compact owner summary with per-metric coverage and no processor or file expansion', () => {
    const telemetry = createResourceTelemetryFixture();
    telemetry.ram.physical_available.minimum = 3 * gib;
    telemetry.commit.headroom.minimum = 2 * gib;
    render(<ResourceTelemetrySummary telemetry={resourceTelemetrySchema.parse(telemetry)} />);
    expect(screen.getByText('Resources · Available').closest('details')?.open).toBe(false);
    expect(screen.getByText('Minimum available RAM').nextElementSibling?.textContent).toBe(
      '3 GiB · 100% coverage',
    );
    expect(screen.getByText('Minimum commit headroom').nextElementSibling?.textContent).toBe(
      '2 GiB · 100% coverage',
    );
    expect(screen.queryByText(/Logical processors|Individual pagefiles/)).toBeNull();
  });
});
