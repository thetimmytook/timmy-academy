import { z } from 'zod';

const toggle = z.boolean().optional();
const token = z
  .string()
  .regex(/^[A-Za-z]\w{0,39}$/)
  .optional();
const enumCode = z.number().int().min(0).max(15).optional();
const dimension = z.number().int().min(1).max(16384);

// Exact saved-key allowlist from design/benchmark-settings-allowlist.md.
export const settingsSnapshotSchema = z
  .strictObject({
    schema_version: z.literal(1),
    game: z
      .strictObject({
        AutoEmptyWorkingSet: toggle,
        SetAffinityToLogicalCores: toggle,
      })
      .refine(section => Object.keys(section).length > 0)
      .optional(),
    graphics: z
      .strictObject({
        DisplaySettings: z
          .strictObject({
            FullScreenMode: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
            Resolution: z.strictObject({ Width: dimension, Height: dimension }).optional(),
          })
          .refine(section => Object.keys(section).length > 0)
          .optional(),
        TextureQuality: enumCode,
        ShadowsQuality: enumCode,
        LodBias: z.number().min(0).max(10).optional(),
        OverallVisibility: z.number().min(0).max(10000).optional(),
        CloudsQuality: token,
        AntiAliasing: token,
        VolumetricLight: token,
        DLSSMode: token,
        DLSSPreset: token,
        FSR2Mode: token,
        FSR3Mode: token,
        SuperSampling: token,
        SuperSamplingFactor: z.number().min(0.1).max(8).optional(),
        Ssao: token,
        SSR: token,
        AnisotropicFiltering: token,
        NVidiaReflex: token,
        Sharpen: z.number().min(0).max(10).optional(),
        VSync: toggle,
        DisableGameFramerateLimit: toggle,
        LobbyFramerate: z.number().min(0).max(1000).optional(),
        GameFramerate: z.number().min(0).max(1000).optional(),
        HighQualityColor: toggle,
        ZBlur: toggle,
        AreaLightsInstancing: toggle,
        ChromaticAberrations: toggle,
        Noise: toggle,
        GrassShadow: toggle,
        SdTarkovStreets: toggle,
      })
      .refine(section => Object.keys(section).length > 0)
      .optional(),
    postfx: z
      .strictObject({ EnablePostFx: toggle })
      .refine(section => Object.keys(section).length > 0)
      .optional(),
  })
  .refine(
    snapshot =>
      snapshot.game !== undefined ||
      snapshot.graphics !== undefined ||
      snapshot.postfx !== undefined,
  );

export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;
