import Link from "next/link";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/student/page-header";
import { StudentPage } from "@/components/student/student-page";

/**
 * Polished lock for paid sections (UX). Authorization for paid
 * content remains RPC/RLS. Academic year/Block browse stays open;
 * individual items stay entitlement-gated.
 * Does not render protected catalog data.
 */
export function SectionLock({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <StudentPage>
      <PageHeader title={title} />
      <Card className="shadow-none">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Lock className="size-3" aria-hidden />
              subscription required
            </Badge>
          </div>
          <CardTitle className="text-base text-[var(--student-ink)]">
            Unlock {title}
          </CardTitle>
          <CardDescription>
            {description ??
              "This section is part of a MedVerse subscription. You can still browse every class and Block — individual items stay entitlement-gated. Pending applications do not unlock paid sections."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/subscription">Get Subscription</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/contact">Contact MedVerse</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/academic">Browse Academic</Link>
          </Button>
        </CardContent>
      </Card>
    </StudentPage>
  );
}
