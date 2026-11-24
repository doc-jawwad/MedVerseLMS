export const OSPE_BULK_MAX_ITEMS = 20;
export const OSPE_BULK_MAX_BYTES = 100 * 1024 * 1024;

export function validateOspeBulkItem(item: {
  requestId: string; title: string; answer: string; sortOrder: number;
}): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.requestId)) {
    return "Invalid import ID.";
  }
  if (!item.title.trim() || item.title.trim().length > 200) return "Enter a title of 1–200 characters.";
  if (!item.answer.trim() || item.answer.trim().length > 20_000) return "Enter an answer of 1–20,000 characters.";
  if (!Number.isSafeInteger(item.sortOrder) || item.sortOrder < 0 || item.sortOrder > 2_147_483_647) return "Invalid sort order.";
  return null;
}

export function matchesOspeBulkReplay(value: unknown, expected: {
  requestId: string; userId: string; yearId: string; subjectId: string;
  title: string; answer: string; sortOrder: number; contentType: string; byteSize: number;
}) {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.id === expected.requestId && row.created_by === expected.userId &&
    row.year_id === expected.yearId && row.subject_id === expected.subjectId &&
    row.title === expected.title && row.answer === expected.answer && row.status === "draft" &&
    row.sort_order === expected.sortOrder && row.r2_content_type === expected.contentType &&
    row.r2_byte_size === expected.byteSize;
}

export function ospeBulkBatchError(sizes: readonly number[]): string | null {
  if (!sizes.length || sizes.length > OSPE_BULK_MAX_ITEMS) return "Select 1–20 images.";
  if (sizes.some(size => !Number.isSafeInteger(size) || size <= 0)) return "Every image must be nonempty.";
  if (sizes.reduce((sum, size) => sum + size, 0) > OSPE_BULK_MAX_BYTES) return "Batch must be at most 100 MB.";
  return null;
}
