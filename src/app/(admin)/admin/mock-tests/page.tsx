import { redirect } from "next/navigation";

// Mock Tests are built on the existing Tests infrastructure — test_type='mock'.
// This route provides a direct entry point that pre-filters to mock tests.
export default function MockTestsRedirect() {
  redirect("/admin/tests?type=mock");
}
