/** Indent via padding (not margin) so full-width rows cannot exceed the viewport. */
export function treeIndentStyle(
  level: number,
  extraPx = 0
): { paddingLeft: string } {
  return {
    paddingLeft: `calc(${level} * var(--tree-indent, 12px) + ${extraPx}px)`,
  };
}
