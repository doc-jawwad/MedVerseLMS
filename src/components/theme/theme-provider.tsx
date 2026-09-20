"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { THEME_STORAGE_KEY } from "@/lib/theme/storage";

export { THEME_STORAGE_KEY };

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
