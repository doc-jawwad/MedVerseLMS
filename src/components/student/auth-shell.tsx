import { Logo } from "@/components/logo";
import { BrandCredit } from "@/components/brand-credit";
import { InstallMedverseApp } from "@/components/pwa/install-medverse-app";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[var(--brand-navy)] px-10 py-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{
            background:
              "radial-gradient(ellipse at 18% 8%, color-mix(in oklab, var(--brand-teal) 55%, transparent), transparent 55%), radial-gradient(ellipse at 92% 88%, color-mix(in oklab, var(--brand-teal) 28%, transparent), transparent 48%)",
          }}
        />
        <Logo />
        <div className="relative max-w-md">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[var(--brand-teal)] uppercase">
            Medical education
          </p>
          <h1 className="mt-3 font-heading text-4xl font-semibold tracking-tight text-balance">
            Prepared, calm, exam-ready.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            MedVerse LMS for MBBS Years 1–5 — scheduled tests, practice MCQs,
            and study materials in one academy workspace.
          </p>
        </div>
        <BrandCredit tone="auth" className="relative" />
      </aside>
      <div className="flex flex-col bg-[var(--student-canvas)]">
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <Logo dark />
            </div>
            {children}
            <div className="mt-8">
              <InstallMedverseApp variant="button" />
            </div>
          </div>
        </div>
        <footer className="px-4 py-4 text-center lg:hidden">
          <BrandCredit />
        </footer>
      </div>
    </div>
  );
}
