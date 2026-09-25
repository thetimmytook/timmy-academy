import type { PublicSettings, SettingsSnapshot } from '@timmy/contracts';

const screenModes = ['fullscreen', 'borderless', 'windowed'] as const;

function presentFields<T extends object>(fields: T): Partial<T> | undefined {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);

  return entries.length ? (Object.fromEntries(entries) as Partial<T>) : undefined;
}

// Input has already passed the submission contract. Copy only approved public fields.
export function projectSubmissionSettings(
  snapshot: SettingsSnapshot | null,
): PublicSettings | null {
  if (snapshot === null) {
    return null;
  }

  const source = snapshot.graphics;
  const mode = source?.DisplaySettings?.FullScreenMode;
  const game = snapshot.game
    ? presentFields({
        automatic_ram_cleaner: snapshot.game.AutoEmptyWorkingSet,
        only_use_physical_cores: snapshot.game.SetAffinityToLogicalCores,
      })
    : undefined;
  const graphics = source
    ? presentFields({
        screen_mode: mode === undefined ? undefined : screenModes.at(mode),
        texture_quality_code: source.TextureQuality,
        shadows_quality_code: source.ShadowsQuality,
        object_lod: source.LodBias,
        overall_visibility: source.OverallVisibility,
        clouds_quality: source.CloudsQuality,
        anti_aliasing: source.AntiAliasing,
        volumetric_lighting: source.VolumetricLight,
        dlss_mode: source.DLSSMode,
        dlss_preset: source.DLSSPreset,
        fsr2_mode: source.FSR2Mode,
        fsr3_mode: source.FSR3Mode,
        resampling_mode: source.SuperSampling,
        resampling_factor: source.SuperSamplingFactor,
        hbao: source.Ssao,
        ssr: source.SSR,
        anisotropic_filtering: source.AnisotropicFiltering,
        nvidia_reflex: source.NVidiaReflex,
        sharpness: source.Sharpen,
        vsync: source.VSync,
        disable_game_fps_limit: source.DisableGameFramerateLimit,
        lobby_fps_limit: source.LobbyFramerate,
        game_fps_limit: source.GameFramerate,
        high_quality_color: source.HighQualityColor,
        z_blur: source.ZBlur,
        area_light_instancing: source.AreaLightsInstancing,
        chromatic_aberrations: source.ChromaticAberrations,
        noise: source.Noise,
        grass_shadows: source.GrassShadow,
        streets_lower_texture_resolution: source.SdTarkovStreets,
      })
    : undefined;
  const postfx = snapshot.postfx
    ? presentFields({ enabled: snapshot.postfx.EnablePostFx })
    : undefined;

  if (!game && !graphics && !postfx) {
    return null;
  }

  return {
    ...(game ? { game } : {}),
    ...(graphics ? { graphics } : {}),
    ...(postfx ? { postfx } : {}),
  };
}
