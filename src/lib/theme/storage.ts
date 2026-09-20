/** Local-only preference key — no user PII, no DB theme table. */
export const THEME_STORAGE_KEY = "medverse-theme";

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export function isThemeMode(value: string): value is ThemeMode {
  return (THEME_MODES as readonly string[]).includes(value);
}
