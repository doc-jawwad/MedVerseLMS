import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { PwaRuntimeProvider } from "@/components/pwa/pwa-runtime-provider";
import { PwaUpdateBanner } from "@/components/pwa/pwa-update-banner";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "MedVerse",
  title: "MedVerse LMS",
  description: "Online MCQ test platform for MBBS students",
  appleWebApp: {
    capable: true,
    title: "MedVerse",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    apple: "/icons/apple-touch-icon.png",
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#072855",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <PwaRuntimeProvider>
            {children}
            <PwaUpdateBanner />
            <Toaster richColors />
          </PwaRuntimeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
