const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/** Fit PDF page width into a container (minus padding), clamped. */
export function fitWidthScale(
  containerWidth: number,
  pageWidthAtScale1: number,
  padding = 8
): number {
  if (
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(pageWidthAtScale1) ||
    containerWidth <= 0 ||
    pageWidthAtScale1 <= 0
  ) {
    return 1;
  }
  const usable = Math.max(32, containerWidth - padding);
  const raw = usable / pageWidthAtScale1;
  return Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Number(raw.toFixed(3)))
  );
}
