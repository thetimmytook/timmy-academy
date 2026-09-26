import { publicSettingsSchema, settingsSnapshotSchema } from '@timmy/contracts';
import { describe, expect, it } from 'vitest';

import { projectSubmissionSettings } from './submission-settings';

import type { SettingsSnapshot } from '@timmy/contracts';

describe('submission settings public projection', () => {
  it('maps the documented selected-key example without defaults or inferred effects', () => {
    const snapshot = settingsSnapshotSchema.parse({
      schema_version: 1,
      game: { AutoEmptyWorkingSet: false, SetAffinityToLogicalCores: true },
      graphics: {
        DisplaySettings: { FullScreenMode: 1, Resolution: { Width: 2560, Height: 1440 } },
        TextureQuality: 2,
        ShadowsQuality: 0,
        AntiAliasing: 'TAA_High',
        DLSSMode: 'Off',
        FSR2Mode: 'Off',
        FSR3Mode: 'Off',
        VSync: false,
        HighQualityColor: false,
      },
      postfx: { EnablePostFx: false },
    });
    const result = projectSubmissionSettings(snapshot);
    expect(result).toEqual({
      game: { automatic_ram_cleaner: false, only_use_physical_cores: true },
      graphics: {
        screen_mode: 'borderless',
        texture_quality_code: 2,
        shadows_quality_code: 0,
        anti_aliasing: 'TAA_High',
        dlss_mode: 'Off',
        fsr2_mode: 'Off',
        fsr3_mode: 'Off',
        vsync: false,
        high_quality_color: false,
      },
      postfx: { enabled: false },
    });
    expect(publicSettingsSchema.parse(result)).toEqual(result);
    expect(Object.keys(result!.graphics!)).not.toContain('resampling_factor');
  });
  it.each([
    [0, 'fullscreen'],
    [1, 'borderless'],
    [2, 'windowed'],
  ] as const)('maps recorded screen mode %i to %s', (code, name) => {
    expect(
      projectSubmissionSettings({
        schema_version: 1,
        graphics: { DisplaySettings: { FullScreenMode: code } },
      }),
    ).toEqual({ graphics: { screen_mode: name } });
  });
  it('returns null when only resolution is present, since it belongs to conditions', () => {
    expect(projectSubmissionSettings(null)).toBeNull();
    expect(
      projectSubmissionSettings({
        schema_version: 1,
        graphics: { DisplaySettings: { Resolution: { Width: 1920, Height: 1080 } } },
      }),
    ).toBeNull();
  });
  it('preserves zero, false and bounded unknown tokens without interpretation', () => {
    const result = projectSubmissionSettings({
      schema_version: 1,
      graphics: {
        TextureQuality: 15,
        LodBias: 0,
        OverallVisibility: 0,
        CloudsQuality: 'NewMode',
        VolumetricLight: 'Low',
        DLSSPreset: 'Default',
        SuperSampling: 'Off',
        SuperSamplingFactor: 1,
        Ssao: 'FastestPerformance',
        SSR: 'Off',
        AnisotropicFiltering: 'ForceEnable',
        NVidiaReflex: 'On',
        Sharpen: 0,
        DisableGameFramerateLimit: false,
        LobbyFramerate: 0,
        GameFramerate: 0,
        ZBlur: false,
        AreaLightsInstancing: false,
        ChromaticAberrations: false,
        Noise: false,
        GrassShadow: false,
        SdTarkovStreets: false,
      },
    });
    expect(result).toEqual({
      graphics: {
        texture_quality_code: 15,
        object_lod: 0,
        overall_visibility: 0,
        clouds_quality: 'NewMode',
        volumetric_lighting: 'Low',
        dlss_preset: 'Default',
        resampling_mode: 'Off',
        resampling_factor: 1,
        hbao: 'FastestPerformance',
        ssr: 'Off',
        anisotropic_filtering: 'ForceEnable',
        nvidia_reflex: 'On',
        sharpness: 0,
        disable_game_fps_limit: false,
        lobby_fps_limit: 0,
        game_fps_limit: 0,
        z_blur: false,
        area_light_instancing: false,
        chromatic_aberrations: false,
        noise: false,
        grass_shadows: false,
        streets_lower_texture_resolution: false,
      },
    });
    expect(publicSettingsSchema.parse(result)).toEqual(result);
  });
  it('does not copy unlisted fields even if an internal caller bypasses validation', () => {
    const input = {
      schema_version: 1,
      email: 'private',
      game: { AutoEmptyWorkingSet: false, accountId: 'private' },
      graphics: { VSync: false, Stored: ['private'], DisplaySettings: { Display: 1 } },
      postfx: { EnablePostFx: true, Brightness: 50 },
    } as SettingsSnapshot;
    expect(projectSubmissionSettings(input)).toEqual({
      game: { automatic_ram_cleaner: false },
      graphics: { vsync: false },
      postfx: { enabled: true },
    });
  });
});
