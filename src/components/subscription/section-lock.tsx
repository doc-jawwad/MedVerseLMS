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
 * Polished lock for paid LMS section hubs (UX). Authorization for paid
 * content remains RPC/RLS. Free educational items stay on Free Resources.
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
          <CardTitle className="text-base text-[#072855]">
            Unlock {title}
          </CardTitle>
          <CardDescription>
            {description ??
              "This section is part of the subscribed LMS. Free educational items stay available under Free Resources. Pending applications do not unlock paid sections."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/subscription">Get Subscription</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/free-resources">Browse Free Resources</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/subscription#contact-admin">Contact Admin</Link>
          </Button>
        </CardContent>
      </Card>
    </StudentPage>
  );
}
