import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-8 text-center">
      <Image
        src="/logo-icon.png"
        alt="MedVerse"
        width={72}
        height={72}
        priority
      />
      <div>
        <h1 className="text-4xl font-bold tracking-tight">
          Med<span className="text-primary">Verse</span> LMS
        </h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          Online MCQ tests and practice for MBBS students — all five years, all
          subjects.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/register">Register</Link>
        </Button>
      </div>
    </div>
  );
}
