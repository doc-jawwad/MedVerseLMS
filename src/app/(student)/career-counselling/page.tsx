import { redirect } from "next/navigation";

/** Legacy British spelling route — product hub is /career-counseling-series. */
export default function CareerCounsellingRedirectPage() {
  redirect("/career-counseling-series");
}
