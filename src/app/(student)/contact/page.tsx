import Link from "next/link";
import { MEDVERSE_CONTACT, MEDVERSE_CONTACT_LINKS } from "@/lib/contact/medverse-contact";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Contact Us — MedVerse LMS" };

export default function ContactUsPage() {
  return (
    <StudentPage>
      <PageHeader
        title="Contact Us"
        description={`${MEDVERSE_CONTACT.name} — tap any channel below.`}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {MEDVERSE_CONTACT_LINKS.map((item) => (
          <a
            key={item.id}
            href={item.href}
            target={item.href.startsWith("mailto:") ? undefined : "_blank"}
            rel={item.href.startsWith("mailto:") ? undefined : "noreferrer"}
            className="block"
          >
            <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
              <CardHeader>
                <CardTitle className="text-base text-[#072855]">
                  {item.label}
                </CardTitle>
                {item.detail && (
                  <CardDescription className="break-all">{item.detail}</CardDescription>
                )}
                {!item.detail && (
                  <CardDescription className="break-all">{item.href}</CardDescription>
                )}
              </CardHeader>
            </Card>
          </a>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/career-counselling">Career Counselling Series</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/imd-stepwise">Get iMD & StepWise MD Subscription</Link>
        </Button>
      </div>
    </StudentPage>
  );
}
