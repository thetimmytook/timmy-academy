# Benchmark game-settings field inventory

Status: field-mapping draft from the game's Graphics and PostFX UI screenshots and a local read of `Game.ini`, `Graphics.ini`, and `PostFx.ini` on 2026-09-20. The `.ini` files currently contain JSON. This is not yet a validated publication schema or proof that every captured run used these values. PostFX was temporarily enabled for the screenshot; the saved setting was disabled. No local paths or monitor names are recorded here.

## Game

| UI label | Saved JSON key | Observed file value | Notes |
| --- | --- | --- | --- |
| Automatic RAM Cleaner | `game.AutoEmptyWorkingSet` | `false` before test | Confirmed: manually enabling the UI switch and saving changed this key to `true`; the physical-cores key stayed `true`. |
| Only use Physical cores | `game.SetAffinityToLogicalCores` | `true` before test | Confirmed: manually disabling the UI switch and saving changed this key to `false`; restoring the UI switch returned it to `true`. The mapping is direct in this game version. |

`Game.ini` also contains unrelated gameplay and account preferences. Accept only reviewed keys, never the complete file as a public object.

## Graphics

| UI label | Saved JSON key | Observed file value | Mapping note |
| --- | --- | --- | --- |
| Screen resolution | `graphics.DisplaySettings.Resolution.Width/Height` | `2560 × 1440` before test | Confirmed as the game's active selected screen-resolution pair: changing Borderless from 2560×1440 to 1920×1080 changed this pair while Windows display mode stayed 2560×1440. In Windowed it changed to the saved 2400×1372 window size. This does not measure the internal render resolution or physical monitor output. |
| Aspect ratio | `graphics.DisplaySettings.AspectRatio.X/Y` | `16:9` | Matches screenshot. |
| Screen mode | `graphics.DisplaySettings.FullScreenMode` | `1` before test | Confirmed by separate UI selections and saved-file reads: `0` = Fullscreen, `1` = Borderless, `2` = Windowed in this game version. |
| Monitor | `graphics.DisplaySettings.Display` | `0` | A local display index; omit monitor name and index from publication. |
| VSync | `graphics.VSync` | `false` | Direct. |
| Overall graphics quality | `graphics.GraphicsQuality` | `null` | Screenshot reads Custom; confirm preset enum values. |
| Texture quality | `graphics.TextureQuality` | `2` | Screenshot reads High; confirm enum values. |
| Shadows quality | `graphics.ShadowsQuality` | `0` | Screenshot reads Low; confirm enum values. |
| Object LOD quality | `graphics.LodBias` | `2.5` | Direct. |
| Overall visibility | `graphics.OverallVisibility` | `1000` | Direct. |
| Clouds quality | `graphics.CloudsQuality` | `Low` | Direct. |
| Anti-aliasing | `graphics.AntiAliasing` | `TAA_High` | Screenshot reads TAA High. |
| Volumetric lighting | `graphics.VolumetricLight` | `Low` | Direct. |
| NVIDIA DLSS | `graphics.DLSSMode` | `Off` | Direct. |
| DLSS Preset | `graphics.DLSSPreset` | `Default` | UI control is disabled while DLSS is Off; retain value but do not treat it as active. |
| AMD FSR 2.2 | `graphics.FSR2Mode` | `Off` | Direct. |
| AMD FSR 3.0 | `graphics.FSR3Mode` | `Off` | Direct. |
| Resampling | `graphics.SuperSampling` and `graphics.SuperSamplingFactor` | `Off`, `1.0` | Screenshot reads 1× Off; verify meanings of nondefault combinations. |
| HBAO | `graphics.Ssao` | `FastestPerformance` | Screenshot reads Max performance; UI/storage naming differs. |
| SSR | `graphics.SSR` | `Off` | Direct. |
| Anisotropic filtering | `graphics.AnisotropicFiltering` | `ForceEnable` | Screenshot reads On; retain raw enum until mapping is verified. |
| NVIDIA Reflex Low Latency | `graphics.NVidiaReflex` | `On` | Direct. |
| Sharpness | `graphics.Sharpen` | `0.6` | Direct. |
| Disable game FPS limit | `graphics.DisableGameFramerateLimit` | `false` | Direct. |
| Lobby FPS Limit | `graphics.LobbyFramerate` | `120` | Direct. |
| Game FPS Limit | `graphics.GameFramerate` | `120` | Direct. |
| High-quality color | `graphics.HighQualityColor` | `false` | Direct. |
| Z-Blur | `graphics.ZBlur` | `false` | Direct. |
| Area Light Instancing | `graphics.AreaLightsInstancing` | `true` | Direct. |
| Chromatic aberrations | `graphics.ChromaticAberrations` | `false` | Direct. |
| Noise | `graphics.Noise` | `false` | Direct. |
| Grass shadows | `graphics.GrassShadow` | `false` | Direct. |
| Streets of Tarkov Lower Texture Resolution Mode | `graphics.SdTarkovStreets` | `false` | Direct. |

Other saved graphics keys include `ShadowDistance`, `HighQualityFog`, `MipStreamingBufferSize`, `MipStreamingIOCount`, `DLSSEnabled`, `FSR2Enabled`, `FSR3Enabled`, `InApplyDisplaySettingsProcess`, and `Stored[]`. Their user-facing semantics and public necessity have not been reviewed; do not accept them into the public settings DTO by default.

## PostFX

| UI label | Saved JSON key | Screenshot value | Observed file value |
| --- | --- | --- | --- |
| Enable PostFX | `postfx.EnablePostFx` | On | `false` |
| Brightness | `postfx.Brightness` | `0` | `0` |
| Clarity | `postfx.Clarity` | `0` | `0` |
| Luma sharpen | `postfx.LumaSharpen` | `0` | `0` |
| Adaptive sharpen | `postfx.AdaptiveSharpen` | `0` | `0` |
| Color grading | `postfx.ColorFilterType` | Jason | `Jason` |
| Color grading intensity | `postfx.Intensity` | `50` | `50` |
| Colorblind mode | `postfx.ColorBlindnessType` | None | `None` |
| Colorblind intensity | `postfx.ColorBlindnessIntensity` | `0` | `0` |

`postfx.Saturation` and `postfx.Colorfulness` are present in the file but not visible in the supplied screenshot. PostFX was enabled only to show its controls in the screenshot; the saved `EnablePostFx: false` is the user's actual setting. For the initial public run details, show the saved enabled state; do not use slider values as comparison/grouping keys or claim they have zero performance cost without measurement. Their local retention and private publication-snapshot inclusion require a separate field review.

## Contract follow-up

Define a versioned allowlist using exact JSON key paths, types, bounded values and enum mappings. The controlled checks above establish `DisplaySettings.Resolution` as the selected game screen resolution for all three UI screen modes. Call it a configured game value, not measured physical output or internal render resolution; resampling, DLSS and FSR remain separate recorded settings. Preserve `unknown` if the settings are absent or malformed. The public projection must omit monitor identifiers and all unreviewed keys. Capture settings at run time rather than joining a published run to the user's later settings.
