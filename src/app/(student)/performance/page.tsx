/**
 * /performance is no longer a standalone page — its content has been merged
 * into the Dashboard. Redirect permanently so bookmarks and old links still work.
 */
import { redirect } from "next/navigation";

export const metadata = { title: "Performance — MedVerse LMS" };

export default function PerformancePage() {
  redirect("/dashboard");
}
