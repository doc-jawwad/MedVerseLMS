import Link from "next/link";
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

export const metadata = { title: "Pending approval — MedVerse LMS" };

export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const noEnrollment = state === "none";

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Logo dark className="mb-2" />
          <CardTitle>
            {noEnrollment ? "No active enrollment" : "Awaiting approval"}
          </CardTitle>
          <CardDescription>
            {noEnrollment
              ? "Your enrollment is not active (it may have been suspended or revoked). Contact your academy admin."
              : "Your registration was received. An admin needs to approve your enrollment before you can access the platform. Check back later."}
          </CardDescription>
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
