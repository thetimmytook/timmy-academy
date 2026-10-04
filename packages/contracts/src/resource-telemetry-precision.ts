// ResourceSummary in C# rounds durations (seconds) and coverage (0..1) independently.
const RESOURCE_SUMMARY_DECIMAL_PLACES = 6;
const RESOURCE_SUMMARY_ROUNDING_STEP = 10 ** -RESOURCE_SUMMARY_DECIMAL_PLACES;

export const RESOURCE_DURATION_ROUNDING_TOLERANCE_SEC = RESOURCE_SUMMARY_ROUNDING_STEP / 2;
export const RESOURCE_COVERAGE_ROUNDING_TOLERANCE = RESOURCE_SUMMARY_ROUNDING_STEP / 2;

// Core marks coverage as available when it is at least 1 minus this tolerance.
export const RESOURCE_COMPLETE_COVERAGE_TOLERANCE = 1e-6;

// Floating-point slack at interval boundaries, not a measurement tolerance.
export const RESOURCE_COVERAGE_FLOATING_POINT_SLACK = 1e-9;
