/** Clock formats from ExamPlayer.formatClock — MM:SS or H:MM:SS. */

/** ~50–60 minutes remaining (fresh 60-minute attempt). */
export const NEAR_HOUR_REMAINING =
  /^(?:1:0[0-5]:\d{2}|5[0-9]:\d{2}|60:\d{2})$/;

export function isNearHourRemaining(text: string | null | undefined): boolean {
  return !!text && NEAR_HOUR_REMAINING.test(text.trim());
}
