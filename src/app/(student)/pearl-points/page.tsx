import { redirect } from "next/navigation";

/** Legacy Pearl Points hub — canonical student surface is One Liner. */
export default function LegacyPearlPointsRedirect() {
  redirect("/one-liner");
}
