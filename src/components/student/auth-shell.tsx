import { Logo } from "@/components/logo";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#072855] px-10 py-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 20% 0%, #05aea966, transparent 55%), radial-gradient(ellipse at 90% 90%, #05aea933, transparent 45%)",
          }}
        />
        <Logo />
        <div className="relative max-w-md">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[#05AEA9] uppercase">
            Medical education
          </p>
          <h1 className="mt-3 font-heading text-4xl font-semibold tracking-tight">
            Prepared, calm, exam-ready.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            MedVerse LMS for MBBS Years 1–5 — scheduled tests, practice MCQs,
            and study materials in one academy workspace.
          </p>
        </div>
        <p className="relative text-xs text-white/45">
          MedVerse Healthcare
        </p>
      </aside>
      <div className="flex items-center justify-center bg-[var(--student-canvas)] px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <Logo dark />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
