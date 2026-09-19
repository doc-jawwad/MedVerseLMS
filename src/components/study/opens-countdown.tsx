"use client";

import { useEffect, useState } from "react";
import { countdownParts } from "@/lib/study/upcoming";

export function OpensCountdown({ opensAt }: { opensAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const { label } = countdownParts(opensAt, now);
  if (!label) return null;
  return (
    <p className="text-sm font-medium text-[#05AEA9]" data-testid="opens-countdown">
      {label}
    </p>
  );
}
