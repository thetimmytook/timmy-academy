import { css } from '../../styled-system/css';
import { panel } from '../../styled-system/recipes';
import { DefinitionList } from '../elements/DefinitionList';

import { words } from './format';
import { muted, stack } from './styles';

import type { PublicSettings as PublicSettingsData } from '@timmy/contracts';

const settingLabels = new Map([
  ['automatic_ram_cleaner', 'Automatic RAM Cleaner'],
  ['only_use_physical_cores', 'Only use physical cores'],
  ['object_lod', 'Object LOD'],
  ['dlss_mode', 'DLSS mode'],
  ['dlss_preset', 'DLSS preset'],
  ['fsr2_mode', 'FSR 2 mode'],
  ['fsr3_mode', 'FSR 3 mode'],
  ['hbao', 'HBAO'],
  ['ssr', 'SSR'],
  ['nvidia_reflex', 'NVIDIA Reflex'],
  ['vsync', 'VSync'],
  ['lobby_fps_limit', 'Lobby FPS limit'],
  ['game_fps_limit', 'Game FPS limit'],
]);

function settingValue(value: string | number | boolean | undefined) {
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }
  return value === undefined ? 'Unknown' : String(value);
}

export function PublicSettings({ settings }: Readonly<{ settings: PublicSettingsData | null }>) {
  return (
    <section className={`${panel()} ${stack}`}>
      <h2 className={css({ textStyle: 'h2' })}>Public settings</h2>
      <p className={muted}>
        Only recorded public settings are shown. Missing settings are unknown. Quality codes and
        saved mode tokens are displayed as recorded.
      </p>
      {settings ? (
        <div
          className={css({
            display: 'grid',
            gap: '6',
            gridTemplateColumns: { base: 'minmax(0, 1fr)', tablet: 'repeat(2, minmax(0, 1fr))' },
          })}
        >
          {Object.entries(settings)
            .filter(([, values]) => Object.keys(values ?? {}).length > 0)
            .map(([section, values]) => (
              <section key={section}>
                <h3 className={css({ textStyle: 'h3', mb: '4' })}>
                  {section === 'postfx' ? 'PostFX' : words(section)}
                </h3>
                <DefinitionList
                  values={Object.entries(values ?? {}).map(([key, value]) => [
                    settingLabels.get(key) ?? words(key),
                    settingValue(value),
                  ])}
                />
              </section>
            ))}
        </div>
      ) : (
        <p>No public settings recorded.</p>
      )}
    </section>
  );
}
