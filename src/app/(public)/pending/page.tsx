import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/actions/auth";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";
import { isBlockedAccountStatus } from "@/lib/auth/account-status";

export const metadata = { title: "Account — MedVerse LMS" };

const blockedCopy: Record<string, { title: string; description: string }> = {
  restricted: {
    title: "Account restricted",
    description:
      "This account is restricted and cannot access MedVerse LMS. Contact your academy admin if you believe this is a mistake.",
  },
  suspended: {
    title: "Account suspended",
    description:
      "This account is temporarily suspended. You cannot access MedVerse LMS until an admin restores it.",
  },
  deactivated: {
    title: "Account deactivated",
    description:
      "This account has been deactivated and cannot access MedVerse LMS. Contact your academy admin.",
  },
  revoked: {
    title: "Account revoked",
    description:
      "Access for this account has been revoked. Contact your academy admin.",
  },
  none: {
    title: "No class assigned",
    description:
      "Your account has no active MBBS class assignment. Contact your academy admin.",
  },
};

export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;

  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, account_status")
      .eq("id", userId)
      .maybeSingle();

    if (profile && !isBlockedAccountStatus(profile.account_status)) {
      if (profile.role === "admin") {
        redirect("/admin");
      }
      const { data: enrollment } = await supabase
        .from("enrollments")
        .select("id")
        .eq("status", "active")
        .maybeSingle();
      if (enrollment) {
        redirect("/dashboard");
      }
    }

    const statusKey = isBlockedAccountStatus(profile?.account_status)
      ? profile!.account_status
      : state && blockedCopy[state]
        ? state
        : "none";
    const copy = blockedCopy[statusKey] ?? blockedCopy.none;

    return <PendingNotice title={copy.title} description={copy.description} />;
  }

  const copy = (state && blockedCopy[state]) || blockedCopy.none;
  return <PendingNotice title={copy.title} description={copy.description} />;
}

function PendingNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Logo dark className="mb-2" />
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <form action={signOutAction}>
            <Button variant="outline" type="submit">
              Sign out
            </Button>
          </form>
          <Button asChild variant="ghost">
            <Link href="/login">Back to login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
