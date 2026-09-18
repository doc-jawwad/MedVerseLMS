import Link from "next/link";

const links = [
  { href: "/admin/subscriptions", label: "Subscriptions", match: "exact" as const },
  {
    href: "/admin/subscriptions/applications",
    label: "Applications",
    match: "prefix" as const,
  },
  {
    href: "/admin/subscriptions/plans",
    label: "Plans",
    match: "prefix" as const,
  },
  {
    href: "/admin/subscriptions/payment-settings",
    label: "Payment settings",
    match: "prefix" as const,
  },
];

export function SubscriptionAdminNav({ currentPath }: { currentPath: string }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {links.map((l) => {
        const active =
          l.match === "exact"
            ? currentPath === l.href
            : currentPath === l.href || currentPath.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md border px-3 py-1 ${
              active ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}

export const subStatusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  cancelled: "outline",
  expired: "outline",
  grace: "secondary",
  deactivated: "outline",
};
