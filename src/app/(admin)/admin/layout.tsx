import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-user";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

const nav = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/students", label: "Students" },
  { href: "/admin/curriculum", label: "Curriculum" },
  { href: "/admin/questions", label: "Question Bank" },
  { href: "/admin/tests", label: "Tests" },
  { href: "/admin/materials", label: "Materials" },
  { href: "/admin/audit-logs", label: "Audit Log" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireAdmin();

  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/30 p-4 md:flex">
        <div className="mb-6">
          <div className="text-lg font-semibold">MedVerse Admin</div>
          <div className="text-sm text-muted-foreground">{profile.full_name}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={signOutAction}>
          <Button variant="outline" size="sm" className="w-full" type="submit">
            Sign out
          </Button>
        </form>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b p-4 md:hidden">
          <span className="font-semibold">MedVerse Admin</span>
          <form action={signOutAction}>
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </header>
        <main className="p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
