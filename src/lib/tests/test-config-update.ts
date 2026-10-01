/**
 * Pure allowlist picker for updateTestConfig — kept free of "use server"
 * so unit tests can import without pulling the actions graph.
 */
export type TestConfig = {
  title: string;
  year_id: string;
  subject_id: string | null;
  opens_at: string | null;
  closes_at: string | null;
  duration_minutes: number;
  marks_per_question: number;
  negative_mark: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  show_review: "after_submit" | "after_close" | "never";
  min_questions: number;
  test_type: "formal" | "mock";
};

/** Columns updateTestConfig may write — never status/tenant/created_by/etc. */
export const TEST_CONFIG_UPDATE_KEYS = [
  "title",
  "year_id",
  "subject_id",
  "opens_at",
  "closes_at",
  "duration_minutes",
  "marks_per_question",
  "negative_mark",
  "shuffle_questions",
  "shuffle_options",
  "show_review",
  "min_questions",
  "test_type",
] as const satisfies ReadonlyArray<keyof TestConfig>;

const TEST_CONFIG_UPDATE_KEY_SET = new Set<string>(TEST_CONFIG_UPDATE_KEYS);

/**
 * Pick only allowlisted TestConfig fields from an untrusted partial.
 * Unknown keys are rejected (not silently applied).
 */
export function pickTestConfigUpdate(
  config: Partial<TestConfig> & Record<string, unknown>
): Partial<TestConfig> | { error: string } {
  const unknown = Object.keys(config).filter(
    (k) => !TEST_CONFIG_UPDATE_KEY_SET.has(k)
  );
  if (unknown.length > 0) {
    return { error: "invalid_test_config_field" };
  }
  const out: Partial<TestConfig> = {};
  for (const key of TEST_CONFIG_UPDATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      (out as Record<string, unknown>)[key] = config[key];
    }
  }
  if (Object.keys(out).length === 0) {
    return { error: "no_test_config_fields" };
  }
  return out;
}
