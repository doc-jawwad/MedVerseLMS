/**
 * Admin-facing presentation for validate_test checklist rows.
 * Does not change RPC rules — only how failed items read in the UI.
 */

export type ValidateTestCheck = {
  check: string;
  pass: boolean;
  detail: string;
};

export type PresentedChecklistItem = {
  title: string;
  detail: string;
  /** Extra actionable guidance when the item fails; null when passing. */
  hint: string | null;
};

function isQuestionCountCheck(check: string): boolean {
  return /^question count\s*>=\s*\d+/i.test(check.trim());
}

function questionCountFromDetail(detail: string): number | null {
  const m = detail.match(/(\d+)\s*questions?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Present a single validate_test row for the Pre-publication checklist.
 * Question-count failures get explicit “add at least one question” guidance.
 */
export function presentPublishChecklistItem(
  item: ValidateTestCheck
): PresentedChecklistItem {
  if (isQuestionCountCheck(item.check)) {
    const n = questionCountFromDetail(item.detail);
    if (!item.pass) {
      return {
        title: "At least one question required",
        detail:
          n === 0
            ? "This test currently has 0 questions."
            : item.detail.trim() || "Not enough questions.",
        hint: "Add at least one question (manual pick, CSV import, or random selection) before publishing.",
      };
    }
    return {
      title: "Question count",
      detail: item.detail.trim() || "ok",
      hint: null,
    };
  }

  return {
    title: item.check,
    detail: item.detail,
    hint: null,
  };
}

/**
 * Short reason shown next to the disabled Publish button when checklist fails.
 */
export function publishChecklistBlockReason(
  checklist: readonly ValidateTestCheck[]
): string | null {
  if (checklist.length === 0) {
    return "Publish checklist is unavailable.";
  }
  if (checklist.every((c) => c.pass)) return null;

  const failed = checklist.filter((c) => !c.pass);
  const questionCountFail = failed.find((c) => isQuestionCountCheck(c.check));
  if (questionCountFail) {
    return "Publishing is blocked until this test has at least one question.";
  }
  if (failed.length === 1) {
    const presented = presentPublishChecklistItem(failed[0]!);
    return `Publishing is blocked: ${presented.title}.`;
  }
  return `Publishing is blocked — ${failed.length} checklist items still need fixing.`;
}
