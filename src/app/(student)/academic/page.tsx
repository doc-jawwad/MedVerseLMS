import { AcademicHomeView } from "@/components/academic/academic-browse-views";
import { requireStudent } from "@/lib/auth/require-user";

export const metadata = { title: "Academic — MedVerse LMS" };

export default async function AcademicHomePage() {
  const { enrollment } = await requireStudent();
  return (
    <AcademicHomeView
      yearNumber={enrollment.year_number}
      yearName={enrollment.year_name}
    />
  );
}
