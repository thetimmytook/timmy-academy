# Benchmark settings publication allowlist — v1 draft

Status: proposed selected-key contract, 2026-09-20. Source: [benchmark-settings-inventory.md](benchmark-settings-inventory.md), which records one local JSON read and UI screenshots. This file defines only keys that may cross from the Windows Benchmark into a private publication request and a smaller public projection. It is not permission to upload `Game.ini`, `Graphics.ini` or `PostFx.ini` wholesale.

## Version and input shape

`settings_snapshot.schema_version` accepts only `1`; an unsupported version returns `422 invalid_input` with `field_errors["settings_snapshot.schema_version"]: "unsupported_version"`. The only section names are `game`, `graphics` and `postfx`; a section is omitted when it has no accepted keys or its source file could not be read. A present section contains only the accepted paths in the table below, with the same case as the saved JSON. The Windows client maps selected values from its local run into this DTO. The API rejects an unknown section, key, extra nested object, wrong type or value outside the stated domain with `422 invalid_input`; it does not silently drop extra fields. A missing key is unknown, not a default. `settings_snapshot: null` means no reviewed settings were available. No filename, file content, path or arbitrary settings dictionary is accepted. New accepted paths or changed meanings require a new schema version rather than silently changing version 1.

The `Public field` column is an explicit allowlist for `GET /runs/{publicRunId}`. A dash means private intake only; it must not appear in anonymous search, details or Position. Public values are recorded settings, not claims that one option caused an FPS change. None of these keys changes the exact Position criteria. Keys in the deferred table are **not accepted in v1**.

The screenshots and one saved file establish the key paths and observed types, but not every game menu value. For fixed paths whose saved values are enum-like strings, v1 accepts only an ASCII token matching `^[A-Za-z][A-Za-z0-9_]{0,39}$`; no whitespace, punctuation, paths or free text. Integer enum codes accept `0..15`. Numeric limits below are API safety bounds, **not** assertions about the game's selectable range. Preserve accepted raw tokens/codes in the public detail instead of inventing a UI label for unknown values; a known-label mapping may be added after controlled UI checks. Future values that fail these bounded forms require a reviewed catalog revision. The server also bounds the complete settings object and rejects extra keys.

## Accepted paths in `settings_snapshot` schema 1

| Saved JSON path and publication path | JSON type | Allowed values in v1 | Public field | Status / interpretation |
| --- | --- | --- | --- | --- |
| `Game.ini` `$.AutoEmptyWorkingSet` → `game.AutoEmptyWorkingSet` | boolean | `true`, `false` | `settings.game.automatic_ram_cleaner` | Controlled UI toggle confirmed the direct mapping in this game version. |
| `Game.ini` `$.SetAffinityToLogicalCores` → `game.SetAffinityToLogicalCores` | boolean | `true`, `false` | `settings.game.only_use_physical_cores` | Controlled UI toggle confirmed the direct mapping in this game version; do not invert it. |
| `Graphics.ini` `$.DisplaySettings.Resolution.Width` → `graphics.DisplaySettings.Resolution.Width` | integer | `1..16384` | `conditions.game_resolution.width` | Controlled game-UI changes confirm this is the selected game screen width, distinct from Windows display mode. Both dimensions must be present together. Bound is an API safety limit, not a claim about supported game modes. |
| `Graphics.ini` `$.DisplaySettings.Resolution.Height` → `graphics.DisplaySettings.Resolution.Height` | integer | `1..16384` | `conditions.game_resolution.height` | Same pair and semantics as Width. |
| `Graphics.ini` `$.DisplaySettings.FullScreenMode` → `graphics.DisplaySettings.FullScreenMode` | integer | `0`, `1`, `2` | `settings.graphics.screen_mode` | Controlled UI changes: `0` → `fullscreen`, `1` → `borderless`, `2` → `windowed`. |
| `Graphics.ini` `$.TextureQuality` → `graphics.TextureQuality` | integer | `0..15` | `settings.graphics.texture_quality_code` | Screenshot: `2` reads High. Other labels unverified. |
| `Graphics.ini` `$.ShadowsQuality` → `graphics.ShadowsQuality` | integer | `0..15` | `settings.graphics.shadows_quality_code` | Screenshot: `0` reads Low. Other labels unverified. |
| `Graphics.ini` `$.LodBias` → `graphics.LodBias` | number | finite `0..10` | `settings.graphics.object_lod` | Screenshot and file: `2.5`. |
| `Graphics.ini` `$.OverallVisibility` → `graphics.OverallVisibility` | number | finite `0..10000` | `settings.graphics.overall_visibility` | Screenshot and file: `1000`. |
| `Graphics.ini` `$.CloudsQuality` → `graphics.CloudsQuality` | token | bounded ASCII token | `settings.graphics.clouds_quality` | File: `Low`; other labels unverified. |
| `Graphics.ini` `$.AntiAliasing` → `graphics.AntiAliasing` | token | bounded ASCII token | `settings.graphics.anti_aliasing` | File: `TAA_High`; other labels unverified. |
| `Graphics.ini` `$.VolumetricLight` → `graphics.VolumetricLight` | token | bounded ASCII token | `settings.graphics.volumetric_lighting` | File: `Low`; other labels unverified. |
| `Graphics.ini` `$.DLSSMode` → `graphics.DLSSMode` | token | bounded ASCII token | `settings.graphics.dlss_mode` | File: `Off`; never infer internal render resolution from mode alone. |
| `Graphics.ini` `$.DLSSPreset` → `graphics.DLSSPreset` | token | bounded ASCII token | `settings.graphics.dlss_preset` | File: `Default`; UI control was inactive when DLSS was Off. Do not present it as active then. |
| `Graphics.ini` `$.FSR2Mode` → `graphics.FSR2Mode` | token | bounded ASCII token | `settings.graphics.fsr2_mode` | File: `Off`; exact game menu labels need checking. |
| `Graphics.ini` `$.FSR3Mode` → `graphics.FSR3Mode` | token | bounded ASCII token | `settings.graphics.fsr3_mode` | File: `Off`; exact game menu labels need checking. |
| `Graphics.ini` `$.SuperSampling` → `graphics.SuperSampling` | token | bounded ASCII token | `settings.graphics.resampling_mode` | File: `Off`; do not infer output resolution from it. |
| `Graphics.ini` `$.SuperSamplingFactor` → `graphics.SuperSamplingFactor` | number | finite `0.1..8` | `settings.graphics.resampling_factor` | File: `1.0`; do not label this active when resampling is Off. |
| `Graphics.ini` `$.Ssao` → `graphics.Ssao` | token | bounded ASCII token | `settings.graphics.hbao` | File: `FastestPerformance`, screenshot reads Max performance; retain raw token. |
| `Graphics.ini` `$.SSR` → `graphics.SSR` | token | bounded ASCII token | `settings.graphics.ssr` | File: `Off`. |
| `Graphics.ini` `$.AnisotropicFiltering` → `graphics.AnisotropicFiltering` | token | bounded ASCII token | `settings.graphics.anisotropic_filtering` | File: `ForceEnable`, screenshot reads On; retain raw token. |
| `Graphics.ini` `$.NVidiaReflex` → `graphics.NVidiaReflex` | token | bounded ASCII token | `settings.graphics.nvidia_reflex` | File: `On`. |
| `Graphics.ini` `$.Sharpen` → `graphics.Sharpen` | number | finite `0..10` | `settings.graphics.sharpness` | Screenshot and file: `0.6`. |
| `Graphics.ini` `$.VSync` → `graphics.VSync` | boolean | `true`, `false` | `settings.graphics.vsync` | Direct saved toggle. |
| `Graphics.ini` `$.DisableGameFramerateLimit` → `graphics.DisableGameFramerateLimit` | boolean | `true`, `false` | `settings.graphics.disable_game_fps_limit` | Direct saved toggle. |
| `Graphics.ini` `$.LobbyFramerate` → `graphics.LobbyFramerate` | number | finite `0..1000` | `settings.graphics.lobby_fps_limit` | File: `120`; record value even if another toggle makes it inactive. |
| `Graphics.ini` `$.GameFramerate` → `graphics.GameFramerate` | number | finite `0..1000` | `settings.graphics.game_fps_limit` | File: `120`; record value even if limit is disabled. |
| `Graphics.ini` `$.HighQualityColor` → `graphics.HighQualityColor` | boolean | `true`, `false` | `settings.graphics.high_quality_color` | Direct saved toggle. |
| `Graphics.ini` `$.ZBlur` → `graphics.ZBlur` | boolean | `true`, `false` | `settings.graphics.z_blur` | Direct saved toggle. |
| `Graphics.ini` `$.AreaLightsInstancing` → `graphics.AreaLightsInstancing` | boolean | `true`, `false` | `settings.graphics.area_light_instancing` | Direct saved toggle. |
| `Graphics.ini` `$.ChromaticAberrations` → `graphics.ChromaticAberrations` | boolean | `true`, `false` | `settings.graphics.chromatic_aberrations` | Direct saved toggle. |
| `Graphics.ini` `$.Noise` → `graphics.Noise` | boolean | `true`, `false` | `settings.graphics.noise` | Direct saved toggle. |
| `Graphics.ini` `$.GrassShadow` → `graphics.GrassShadow` | boolean | `true`, `false` | `settings.graphics.grass_shadows` | Direct saved toggle. |
| `Graphics.ini` `$.SdTarkovStreets` → `graphics.SdTarkovStreets` | boolean | `true`, `false` | `settings.graphics.streets_lower_texture_resolution` | Direct saved toggle. |
| `PostFx.ini` `$.EnablePostFx` → `postfx.EnablePostFx` | boolean | `true`, `false` | `settings.postfx.enabled` | The saved file says `false`; the screenshot's temporary On state is not a captured-run value. |

Every accepted path is optional in the request, except that resolution Width and Height form one pair. If an accepted path is absent, its public field is omitted rather than inferred. If no approved public settings field is present, the public detail uses `settings: null`. A non-null public `settings` object contains only the present approved `game` and `graphics` fields and/or `postfx.enabled`. The saved resolution pair appears through `conditions.game_resolution`, not duplicated under `settings`. UI consumers must show a saved mode or FPS limit as inactive when its corresponding enable toggle says so, without discarding the recorded value.

Example selected-key request value matching the observed saved PostFX state:

```json
{
  "schema_version": 1,
  "game": {"AutoEmptyWorkingSet": false, "SetAffinityToLogicalCores": true},
  "graphics": {"DisplaySettings": {"FullScreenMode": 1, "Resolution": {"Width": 2560, "Height": 1440}}, "TextureQuality": 2, "ShadowsQuality": 0, "AntiAliasing": "TAA_High", "DLSSMode": "Off", "FSR2Mode": "Off", "FSR3Mode": "Off", "VSync": false, "HighQualityColor": false},
  "postfx": {"EnablePostFx": false}
}
```

Its approved public settings projection is only:

```json
{"game":{"automatic_ram_cleaner":false,"only_use_physical_cores":true},"graphics":{"screen_mode":"borderless","texture_quality_code":2,"shadows_quality_code":0,"anti_aliasing":"TAA_High","dlss_mode":"Off","fsr2_mode":"Off","fsr3_mode":"Off","vsync":false,"high_quality_color":false},"postfx":{"enabled":false}}
```

For this example, `conditions.game_resolution` is `{ "width": 2560, "height": 1440 }`: the game's selected screen resolution. It is not a claim about internal rendering resolution, the monitor's physical mode or the effects of DLSS/FSR/resampling.

## Deferred inventory paths — not accepted or public in schema 1

`Allowed values: none` below means a client must omit that path and the API rejects it if supplied. The observed value is evidence for later testing, not a complete enum or range. `Public field: —` means no public output or search/Position filter exists yet.

| Saved JSON path | Candidate JSON type; observed value | Allowed values in v1 | Public field | Why deferred |
| --- | --- | --- | --- | --- |
| `graphics.DisplaySettings.AspectRatio.X` / `.Y` | integers; `16` / `9` | none | — | Relationship to actual output and validation range not reviewed. |
| `graphics.GraphicsQuality` | nullable enum; `null` with Custom screenshot | none | — | Preset type and enum unverified. |
| `postfx.Brightness` | number; `0` | none | — | PostFX sliders are not needed in initial public details, search or Position. |
| `postfx.Clarity` | number; `0` | none | — | Same. |
| `postfx.LumaSharpen` | number; `0` | none | — | Same. |
| `postfx.AdaptiveSharpen` | number; `0` | none | — | Same. |
| `postfx.ColorFilterType` | string enum; `Jason` | none | — | Screenshot only; saved PostFX was disabled. |
| `postfx.Intensity` | number; `50` | none | — | Same. |
| `postfx.ColorBlindnessType` | string enum; `None` | none | — | Same. |
| `postfx.ColorBlindnessIntensity` | number; `0` | none | — | Same. |

Always reject `graphics.DisplaySettings.Display` (local display index) and any monitor name. Also reject `graphics.Stored[]`, `ShadowDistance`, `HighQualityFog`, `MipStreamingBufferSize`, `MipStreamingIOCount`, `DLSSEnabled`, `FSR2Enabled`, `FSR3Enabled`, `InApplyDisplaySettingsProcess`, `postfx.Saturation`, `postfx.Colorfulness`, every other unlisted key, and unrelated `Game.ini` preferences. They are not retained in the publication DTO simply because they occur in the local files. A later schema revision requires a separate per-key review.

## Resolution mapping and limits

Controlled checks on 2026-09-20 established the saved UI mapping: Borderless at 2560×1440 stored `FullScreenMode: 1` and `DisplaySettings.Resolution: 2560×1440`; changing only the game-selected Borderless resolution to 1920×1080 changed that pair to 1920×1080 while Windows display mode remained 2560×1440. Switching to Windowed stored `FullScreenMode: 2` and its selected 2400×1372 window size. Fullscreen stored `FullScreenMode: 0` and 2560×1440. The user restored Borderless at 2560×1440 after the checks. This is enough to map the game's selected screen resolution and mode for v1 search and Position. If the pair is absent, `game_resolution` is `null` and strict Position returns `missing_conditions`.

Do not substitute `system.gpu[].current_resolution`, `graphics.Stored[]`, monitor names or display indices. `game_resolution` is **configured in-game screen resolution**, not a measured swap-chain size, internal render resolution or physical monitor output. DLSS, FSR and resampling remain separate recorded settings; no universal FPS normalization follows from this field. If a later feature needs internal or presented resolution, validate and add a separate field rather than reinterpreting this v1 value.

## Remaining field checks

- The two Game-tab mappings were confirmed by separate manual toggles and saved-file reads on 2026-09-20. Recheck if a later EFT version changes their semantics.
- The `FullScreenMode` codes `0`, `1` and `2` were confirmed by controlled UI changes. Enumerate quality, AA, upscaling and other string/integer enum values to refine labels and safety bounds; do not infer full value sets from one screenshot. Review numeric UI ranges before accepting deferred numbers.
- Confirm the saved PostFX enabled state at capture time. The screenshot's temporary enabled controls do not describe the recorded run; PostFX sliders remain outside v1 publication and all search/Position criteria.
- Any newly approved key requires a new reviewed catalog version and an explicit decision about public visibility. Existing published runs keep their captured selected-key snapshot; they are not joined to the user's current settings.
