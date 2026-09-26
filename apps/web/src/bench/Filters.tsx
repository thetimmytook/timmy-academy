import { filterOptionsSchema } from '@timmy/contracts';
import { useNavigate } from 'react-router';

import { css } from '../../styled-system/css';
import { panel } from '../../styled-system/recipes';
import { Button } from '../elements/Button';
import { ErrorMessage } from '../elements/ErrorMessage';

import { FilterDropdown } from './FilterDropdown';
import { resolution } from './format';
import { browseUrl, resetPage } from './navigation';
import { useResource } from './resource';
import { grid, muted, stack } from './styles';

import type { Option } from './FilterDropdown';
import type { JSX } from 'react';

export function Filters({ params }: Readonly<{ params: URLSearchParams }>): JSX.Element {
  const navigate = useNavigate();
  const { data, error, retry } = useResource('/api/bench/v1/filter-options', filterOptionsSchema);

  function change(key: string, value: string): void {
    const next = resetPage(params);

    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }

    void navigate(browseUrl(next));
  }

  const named = (values: { id: string; name: string }[] = []): Option[] =>
    values.map(value => ({ value: value.id, label: value.name }));
  const select = (label: string, key: string, options: Option[]): JSX.Element => (
    <FilterDropdown
      label={label}
      value={params.get(key) ?? ''}
      options={options}
      onChange={value => change(key, value)}
      disabled={!data}
    />
  );
  const currentResolution =
    params.has('game_width') || params.has('game_height')
      ? `${params.get('game_width') ?? ''}x${params.get('game_height') ?? ''}`
      : '';

  return (
    <section aria-label="Search filters" className={`${panel()} ${stack}`}>
      <div>
        <h2 className={css({ textStyle: 'h3' })}>Search runs</h2>
        <p className={muted}>
          Results update as you select filters. Options reflect available public runs.
        </p>
      </div>
      {!data && !error && <p role="status">Loading filter options…</p>}
      {error && <ErrorMessage message={error} retry={retry} />}
      <div className={grid}>
        {select('CPU', 'cpu', named(data?.cpus))}
        {select('GPU', 'gpu', named(data?.gpus))}
        {select(
          'RAM',
          'ram_gb',
          data?.ram_gb.map(value => ({ value: String(value), label: `${value} GB` })) ?? [],
        )}
        {select('Map', 'map', named(data?.maps))}
      </div>
      <details
        open={
          Boolean(params.get('execution') || currentResolution || params.get('game_version')) ||
          undefined
        }
      >
        <summary
          className={css({
            cursor: 'pointer',
            color: 'action.default',
            py: '2',
            _focusVisible: { outline: '2px solid', outlineColor: 'action.default' },
          })}
        >
          More conditions
        </summary>
        <div className={grid}>
          <FilterDropdown
            label="Execution"
            value={params.get('execution') ?? ''}
            options={[
              { value: 'bsg_servers', label: 'BSG servers' },
              { value: 'local', label: 'Local' },
            ]}
            onChange={value => change('execution', value)}
          />
          <FilterDropdown
            label="Game resolution"
            value={currentResolution}
            options={
              data?.game_resolutions.map(value => ({
                value: `${value.width}x${value.height}`,
                label: resolution(value),
              })) ?? []
            }
            disabled={!data}
            onChange={value => {
              const next = resetPage(params);
              const [width, height] = value.split('x');
              next.delete('game_width');
              next.delete('game_height');

              if (width && height) {
                next.set('game_width', width);
                next.set('game_height', height);
              }

              void navigate(browseUrl(next));
            }}
          />
          {select(
            'Game version',
            'game_version',
            data?.game_versions.map(value => ({ value, label: value })) ?? [],
          )}
        </div>
      </details>
      <Button href="/bench/" variant="link">
        Clear filters
      </Button>
    </section>
  );
}
