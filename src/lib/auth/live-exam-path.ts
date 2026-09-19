/** Live exam player path — only place a blocked account may still use the LMS UI. */
export function isLiveExamAttemptPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return /^\/tests\/[^/]+\/attempt\/?$/.test(pathname);
}
