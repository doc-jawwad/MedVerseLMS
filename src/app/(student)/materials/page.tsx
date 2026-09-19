import { SectionLock } from "@/components/subscription/section-lock";
import { getStudentHasLiveSubscription } from "@/lib/subscriptions/student-live-access";
import { studentHasPaidLmsSections } from "@/lib/subscriptions/student-section-access";
import { requireStudent } from "@/lib/auth/require-user";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { LIBRARY_LIST } from "@/lib/library/types";
import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Study library — MedVerse LMS" };

/** Compatibility hub. Typed libraries are the product surface. */
export default async function MaterialsCompatPage() {
  await requireStudent();
  const hasLiveAccess = await getStudentHasLiveSubscription();
  if (!studentHasPaidLmsSections(hasLiveAccess)) {
    return (
      <SectionLock
        title="Study library"
        description="Open the typed library from the menu, or use Free Resources for the curated free subset."
      />
    );
  }

  return (
    <StudentPage>
      <PageHeader
        title="Study library"
        description="Content is split by type. Free Resources remains the curated free subset."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {LIBRARY_LIST.filter((m) => m.folderType).map((m) => (
          <Link key={m.id} href={m.href}>
            <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
              <CardHeader>
                <CardTitle className="text-lg text-[#072855]">{m.label}</CardTitle>
                <CardDescription>{m.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </StudentPage>
  );
}
