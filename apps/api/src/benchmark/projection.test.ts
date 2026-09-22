import { publicSettingsSchema } from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import { projectPublicSettings } from './projection';

describe('public settings projection', () => {
  it('preserves every approved field, including zero and false values', () => {
    const settings = publicSettingsSchema.parse({
      game: { automatic_ram_cleaner: false, only_use_physical_cores: true },
      graphics: {
        screen_mode: 'borderless',
        texture_quality_code: 0,
        shadows_quality_code: 0,
        object_lod: 0,
        overall_visibility: 1000,
        clouds_quality: 'Low',
        anti_aliasing: 'TAA_High',
        volumetric_lighting: 'Low',
        dlss_mode: 'Off',
        dlss_preset: 'Default',
        fsr2_mode: 'Off',
        fsr3_mode: 'Off',
        resampling_mode: 'Off',
        resampling_factor: 1,
        hbao: 'FastestPerformance',
        ssr: 'Off',
        anisotropic_filtering: 'ForceEnable',
        nvidia_reflex: 'On',
        sharpness: 0,
        vsync: false,
        disable_game_fps_limit: false,
        lobby_fps_limit: 0,
        game_fps_limit: 120,
        high_quality_color: false,
        z_blur: false,
        area_light_instancing: true,
        chromatic_aberrations: false,
        noise: false,
        grass_shadows: false,
        streets_lower_texture_resolution: false,
      },
      postfx: { enabled: false },
    });
    expect(projectPublicSettings(settings)).toStrictEqual(settings);
  });
  it('omits missing keys and empty sections, returning null when nothing public remains', () => {
    expect(projectPublicSettings(null)).toBeNull();
    expect(projectPublicSettings({ game: {}, graphics: {}, postfx: {} })).toBeNull();
    const privateOnly = { graphics: { screen_mode: undefined, hostname: 'private-host' } };
    expect(projectPublicSettings(privateOnly)).toBeNull();
    expect(projectPublicSettings({ game: {}, postfx: { enabled: false } })).toStrictEqual({
      postfx: { enabled: false },
    });
  });
  it('still rejects invalid approved values instead of silently hiding data corruption', () => {
    expect(() => projectPublicSettings({ graphics: { texture_quality_code: 100 } })).toThrow();
  });
});
