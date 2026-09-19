import Link from "next/link";
import { MEDVERSE_CONTACT } from "@/lib/contact/medverse-contact";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Career Counselling Series — MedVerse LMS" };

export default function CareerCounsellingPage() {
  return (
    <StudentPage width="narrow">
      <PageHeader
        title="Career Counselling Series"
        description="Guidance from MedVerse Pakistan for MBBS pathways, exams, and next steps."
      />
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[#072855]">Watch and join</CardTitle>
          <CardDescription>
            The series lives on MedVerse channels. Use YouTube for recorded sessions and
            WhatsApp for updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={MEDVERSE_CONTACT.youtube} target="_blank" rel="noreferrer">
              YouTube channel
            </a>
          </Button>
          <Button asChild variant="secondary">
            <a href={MEDVERSE_CONTACT.mdcatChannel} target="_blank" rel="noreferrer">
              MDCAT WhatsApp channel
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/contact">Contact MedVerse</Link>
          </Button>
        </CardContent>
      </Card>
    </StudentPage>
  );
}
