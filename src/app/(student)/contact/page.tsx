import Link from "next/link";
import { ExternalLink, GraduationCap, Award } from "lucide-react";
import { MEDVERSE_CONTACT, MEDVERSE_CONTACT_LINKS } from "@/lib/contact/medverse-contact";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";
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

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {MEDVERSE_CONTACT_LINKS.map((item) => {
          const external = !item.href.startsWith("mailto:");
          return (
            <a
              key={item.id}
              href={item.href}
              target={external ? "_blank" : undefined}
              rel={external ? "noreferrer" : undefined}
              className="group block min-w-0 outline-none"
              data-testid={`contact-link-${item.id}`}
            >
              <Card className="h-full min-w-0 border-border/80 shadow-none transition-colors group-hover:border-[var(--brand-teal)]/50 group-hover:bg-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-[var(--brand-teal)]/45">
                <CardHeader className="gap-1.5">
                  <CardTitle className="flex items-start justify-between gap-2 text-base text-[var(--student-ink)]">
                    <span className="min-w-0 text-balance">{item.label}</span>
                    <ExternalLink
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-80 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </CardTitle>
                  <CardDescription className="text-xs leading-relaxed sm:text-sm">
                    {item.detail ?? "Open channel"}
                  </CardDescription>
                </CardHeader>
              </Card>
            </a>
          );
        })}
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Link
          href="/career-counselling"
          className="group block min-w-0 outline-none"
        >
          <Card className="h-full border-border/80 shadow-none transition-colors group-hover:border-[var(--brand-teal)]/50 group-hover:bg-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-[var(--brand-teal)]/45">
            <CardHeader className="gap-1.5">
              <CardTitle className="flex items-center gap-2 text-base text-[var(--student-ink)]">
                <GraduationCap
                  className="size-4 shrink-0 text-[var(--brand-teal-ink)]"
                  aria-hidden
                />
                Career Counselling Series
              </CardTitle>
              <CardDescription className="text-xs leading-relaxed sm:text-sm">
                MBBS pathways, exams, and next-step guidance from MedVerse.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/imd-stepwise" className="group block min-w-0 outline-none">
          <Card className="h-full border-border/80 shadow-none transition-colors group-hover:border-[var(--brand-teal)]/50 group-hover:bg-accent/40 group-focus-visible:ring-2 group-focus-visible:ring-[var(--brand-teal)]/45">
            <CardHeader className="gap-1.5">
              <CardTitle className="flex items-center gap-2 text-base text-[var(--student-ink)]">
                <Award className="size-4 shrink-0 text-[var(--brand-teal-ink)]" aria-hidden />
                Get iMD & StepWise MD Subscription
              </CardTitle>
              <CardDescription className="text-xs leading-relaxed sm:text-sm">
                Unlock the full class library — MCQ Bank, Pearl Points, and more.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </StudentPage>
  );
}
