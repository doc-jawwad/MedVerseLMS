import Link from "next/link";
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

export const metadata = {
  title: "Get iMD & StepWise MD Subscription — MedVerse LMS",
};

export default function ImdStepwisePage() {
  return (
    <StudentPage width="narrow">
      <PageHeader
        title="Get iMD & StepWise MD Subscription"
        description="Unlock the full MedVerse library for your class: MCQ Bank, Pearl Points, guidelines, OSPE, books, notes, and lectures."
      />
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-[#072855]">
            Subscribe through MedVerse
          </CardTitle>
          <CardDescription>
            Applications use the academy bank-transfer flow. Pending applications do not
            unlock paid sections. Free Resources stay available either way.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/subscription">Get Subscription</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/contact">Contact MedVerse</Link>
          </Button>
        </CardContent>
      </Card>
    </StudentPage>
  );
}
