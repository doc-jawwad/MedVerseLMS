import Link from "next/link";
import { requireStudent } from "@/lib/auth/require-user";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { SessionWatch } from "@/components/session-watch";
import { Logo } from "@/components/logo";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/materials", label: "Study Materials" },
  { href: "/practice", label: "Practice MCQs" },
  { href: "/tests", label: "Tests" },
  { href: "/performance", label: "Performance" },
  { href: "/profile", label: "My Account" },
];

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, enrollment, userId } = await requireStudent();

  return (
    <div className="flex min-h-svh">
      <SessionWatch userId={userId} />
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <div className="mb-6">
          <Logo />
          <div className="mt-3 text-sm text-sidebar-foreground/80">
            {profile.full_name}
          </div>
          <div className="text-xs text-sidebar-foreground/60">
            {enrollment.year_name}
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={signOutAction}>
          <Button
            variant="outline"
            size="sm"
            className="w-full border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            type="submit"
          >
            Sign out
          </Button>
        </form>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b bg-sidebar p-4 text-sidebar-foreground md:hidden">
          <Logo size={24} />
          <form action={signOutAction}>
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              Sign out
            </Button>
          </form>
        </header>
        <main className="p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
