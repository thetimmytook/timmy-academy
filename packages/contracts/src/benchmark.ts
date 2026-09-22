import { z } from 'zod';

export const COHORT_QUERY_MAX_BODY_BYTES = 4096;

const positiveInteger = z.number().int().positive();
const count = z.number().int().nonnegative();
const modelId = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .refine(value => value.split('-').every(part => part.length > 0));
const label = z.string().min(1).max(160);
export const publicRunIdSchema = z.string().regex(/^br_[A-Za-z0-9_-]+$/);
export const groupKeySchema = z.string().regex(/^hg_[A-Za-z0-9_-]+$/);
export const cursorSchema = z.string().regex(/^cur_[A-Za-z0-9_-]+$/);
export const executionSchema = z.enum(['bsg_servers', 'local']);
export const sortSchema = z.enum(['captured_desc', 'captured_asc']);
export const resolutionSchema = z.strictObject({
  width: positiveInteger.max(16384),
  height: positiveInteger.max(16384),
});
export const namedModelSchema = z.strictObject({ id: modelId, name: label });
export const hardwareSchema = z.strictObject({
  cpu: namedModelSchema,
  gpu: namedModelSchema,
  ram_gb: positiveInteger,
});
// Observed values in the public dataset, not a universal hardware catalog.
export const filterOptionsSchema = z.strictObject({
  cpus: z.array(namedModelSchema),
  gpus: z.array(namedModelSchema),
  ram_gb: z.array(positiveInteger),
  maps: z.array(namedModelSchema),
  game_resolutions: z.array(resolutionSchema),
  game_versions: z.array(label),
});
export type FilterOptions = z.infer<typeof filterOptionsSchema>;
export const benchmarkFiltersSchema = z.strictObject({
  cpu: modelId.nullable(),
  gpu: modelId.nullable(),
  ram_gb: positiveInteger.nullable(),
  map: modelId.nullable(),
  execution: executionSchema.nullable(),
  game_width: positiveInteger.max(16384).nullable(),
  game_height: positiveInteger.max(16384).nullable(),
  game_version: label.nullable(),
});
const queryInteger = z.string().regex(/^\d+$/).transform(Number).pipe(positiveInteger);
export const runSearchQuerySchema = z
  .strictObject({
    view: z.enum(['groups', 'items']).default('groups'),
    group_key: groupKeySchema.optional(),
    cpu: modelId.optional(),
    gpu: modelId.optional(),
    ram_gb: queryInteger.optional(),
    map: modelId.optional(),
    execution: executionSchema.optional(),
    game_width: queryInteger.pipe(positiveInteger.max(16384)).optional(),
    game_height: queryInteger.pipe(positiveInteger.max(16384)).optional(),
    game_version: label.optional(),
    sort: sortSchema.default('captured_desc'),
    limit: queryInteger.pipe(positiveInteger.max(50)).default(20),
    // Token validation belongs to the repository so malformed cursors return 400 invalid_cursor.
    cursor: z.string().optional(),
  })
  .superRefine((query, context) => {
    if ((query.view === 'items') !== (query.group_key !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['group_key'],
        message: 'Invalid group selection.',
      });
    }
    if ((query.game_width === undefined) !== (query.game_height === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['game_width'],
        message: 'Supply both dimensions.',
      });
    }
  });
export const summaryMetricsSchema = z.strictObject({
  average_fps: z.number().positive(),
  one_percent_low_fps: z.number().nonnegative(),
});
export const metricsSchema = summaryMetricsSchema.extend({
  zero_point_one_percent_low_fps: z.number().nonnegative(),
  average_frametime_ms: z.number().positive(),
  p95_frametime_ms: z.number().positive(),
  p99_frametime_ms: z.number().positive(),
});
export const publicRunSummarySchema = z.strictObject({
  public_run_id: publicRunIdSchema,
  url: z.string().regex(/^\/bench\/runs\/br_[A-Za-z0-9_-]+$/),
  captured_day: z.iso.date(),
  map: namedModelSchema,
  execution: executionSchema,
  game_resolution: resolutionSchema.nullable(),
  game_version: label.nullable(),
  metrics: summaryMetricsSchema,
});
const token = z.string().regex(/^[A-Za-z]\w{0,39}$/);
const enumCode = z.number().int().min(0).max(15);
const toggle = z.boolean().optional();
export const publicSettingsSchema = z
  .strictObject({
    game: z
      .strictObject({ automatic_ram_cleaner: toggle, only_use_physical_cores: toggle })
      .optional(),
    graphics: z
      .strictObject({
        screen_mode: z.enum(['fullscreen', 'borderless', 'windowed']).optional(),
        texture_quality_code: enumCode.optional(),
        shadows_quality_code: enumCode.optional(),
        object_lod: z.number().min(0).max(10).optional(),
        overall_visibility: z.number().min(0).max(10000).optional(),
        clouds_quality: token.optional(),
        anti_aliasing: token.optional(),
        volumetric_lighting: token.optional(),
        dlss_mode: token.optional(),
        dlss_preset: token.optional(),
        fsr2_mode: token.optional(),
        fsr3_mode: token.optional(),
        resampling_mode: token.optional(),
        resampling_factor: z.number().min(0.1).max(8).optional(),
        hbao: token.optional(),
        ssr: token.optional(),
        anisotropic_filtering: token.optional(),
        nvidia_reflex: token.optional(),
        sharpness: z.number().min(0).max(10).optional(),
        vsync: toggle,
        disable_game_fps_limit: toggle,
        lobby_fps_limit: z.number().min(0).max(1000).optional(),
        game_fps_limit: z.number().min(0).max(1000).optional(),
        high_quality_color: toggle,
        z_blur: toggle,
        area_light_instancing: toggle,
        chromatic_aberrations: toggle,
        noise: toggle,
        grass_shadows: toggle,
        streets_lower_texture_resolution: toggle,
      })
      .optional(),
    postfx: z.strictObject({ enabled: toggle }).optional(),
  })
  .refine(settings =>
    Object.values(settings).some(section =>
      Object.values(section ?? {}).some(value => value !== undefined),
    ),
  );
export const publicRunDetailSchema = z.strictObject({
  public_run_id: publicRunIdSchema,
  url: publicRunSummarySchema.shape.url,
  captured_day: z.iso.date(),
  hardware: hardwareSchema.extend({
    tuning_class: z.enum(['stock', 'overclocked', 'undervolted', 'mixed', 'unknown']).optional(),
  }),
  conditions: z.strictObject({
    map: namedModelSchema,
    execution: executionSchema,
    game_resolution: resolutionSchema.nullable(),
    game_version: label.nullable(),
    // Derived semantics have not been approved in v1. Recorded modes live in settings.
    render_scale: z.null(),
    upscaling: z.null(),
    weather: z.enum(['unknown', 'clear', 'cloudy', 'rain', 'fog', 'snow']),
    time_of_day: z.enum(['unknown', 'day', 'night', 'dawn_dusk']),
  }),
  capture: z.strictObject({ duration_sec: z.number().positive(), sample_count: positiveInteger }),
  metrics: metricsSchema,
  settings: publicSettingsSchema.nullable(),
  // No quality-note codes have been approved yet; do not invent or accept free text.
  quality_notes: z.array(z.never()),
  author: z.strictObject({ display_name: label, avatar_url: z.url().nullable() }).nullable(),
});
const countsSchema = z.strictObject({ run_count: count, contributor_count: count });
const groupSchema = countsSchema.extend({ hardware: hardwareSchema, map_count: count });
export const hardwareGroupSchema = groupSchema.extend({
  group_key: groupKeySchema,
  preview_runs: z.array(publicRunSummarySchema).max(3),
  remaining_run_count: count,
});
const searchResponseFields = {
  filters: benchmarkFiltersSchema,
  sort: sortSchema,
  limit: positiveInteger.max(50),
  next_cursor: cursorSchema.nullable(),
};
export const groupSearchResponseSchema = z.strictObject({
  ...searchResponseFields,
  view: z.literal('groups'),
  summary: countsSchema.extend({ group_count: count }),
  groups: z.array(hardwareGroupSchema).max(50),
});
export const groupRunsResponseSchema = z.strictObject({
  ...searchResponseFields,
  view: z.literal('items'),
  group_key: groupKeySchema,
  group: groupSchema,
  items: z.array(publicRunSummarySchema).max(50),
});
export const runSearchResponseSchema = z.discriminatedUnion('view', [
  groupSearchResponseSchema,
  groupRunsResponseSchema,
]);
export const cohortQuerySchema = z.strictObject({
  hardware: z.strictObject({ cpu_name: label, gpu_name: label, ram_gb: positiveInteger }),
  map: modelId,
  execution: executionSchema,
  game_resolution: resolutionSchema.nullable(),
  game_version: label.nullable(),
});
export const cohortCriteriaSchema = z.strictObject({
  hardware: hardwareSchema,
  map: namedModelSchema,
  execution: executionSchema,
  game_resolution: resolutionSchema.nullable(),
  game_version: label.nullable(),
});
const cohortFields = {
  criteria: cohortCriteriaSchema,
  runs: z.array(publicRunSummarySchema).max(20),
  truncated: z.boolean(),
};
const exactCriteriaSchema = cohortCriteriaSchema.extend({
  game_resolution: resolutionSchema,
  game_version: label,
});
export const cohortResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...cohortFields,
    status: z.literal('matches'),
    criteria: exactCriteriaSchema,
    counts: z.strictObject({ run_count: positiveInteger, contributor_count: positiveInteger }),
    runs: z.array(publicRunSummarySchema).min(1).max(20),
    reason_codes: z.array(z.never()),
  }),
  z.strictObject({
    ...cohortFields,
    status: z.literal('no_data'),
    criteria: exactCriteriaSchema,
    counts: z.strictObject({ run_count: z.literal(0), contributor_count: z.literal(0) }),
    runs: z.array(z.never()),
    truncated: z.literal(false),
    reason_codes: z.tuple([z.literal('no_exact_matches')]),
  }),
  z.strictObject({
    ...cohortFields,
    status: z.literal('missing_conditions'),
    counts: z.null(),
    runs: z.array(z.never()),
    truncated: z.literal(false),
    reason_codes: z.array(z.enum(['unknown_game_resolution', 'game_version_missing'])).min(1),
  }),
]);
export const benchmarkErrorSchema = z.strictObject({
  code: z.enum([
    'invalid_input',
    'unsupported_media_type',
    'payload_too_large',
    'not_found',
    'invalid_cursor',
    'cursor_stale',
    'group_key_stale',
    'internal_error',
    'rate_limited',
    'authentication_required',
    'email_verification_required',
    'not_owner',
    'duplicate_run',
    'idempotency_conflict',
    'publication_deleted',
  ]),
  message: z.string(),
  request_id: z.string(),
  field_errors: z.record(z.string(), z.string()).optional(),
  retry_after_seconds: count.optional(),
});
export type PublicRunId = z.infer<typeof publicRunIdSchema>;
export type GroupKey = z.infer<typeof groupKeySchema>;
export type Hardware = z.infer<typeof hardwareSchema>;
export type BenchmarkFilters = z.infer<typeof benchmarkFiltersSchema>;
export type RunSearchQuery = z.infer<typeof runSearchQuerySchema>;
export type RunSearchResponse = z.infer<typeof runSearchResponseSchema>;
export type GroupSearchResponse = z.infer<typeof groupSearchResponseSchema>;
export type GroupRunsResponse = z.infer<typeof groupRunsResponseSchema>;
export type HardwareGroup = z.infer<typeof hardwareGroupSchema>;
export type PublicRunSummary = z.infer<typeof publicRunSummarySchema>;
export type PublicRunDetail = z.infer<typeof publicRunDetailSchema>;
export type PublicSettings = z.infer<typeof publicSettingsSchema>;
export type CohortQuery = z.infer<typeof cohortQuerySchema>;
export type CohortResponse = z.infer<typeof cohortResponseSchema>;
export type CohortCriteria = z.infer<typeof cohortCriteriaSchema>;
export type BenchmarkError = z.infer<typeof benchmarkErrorSchema>;
