import { MaterialLibraryPage } from "@/components/library/material-library-page";

export const metadata = { title: "OSPE Material — MedVerse LMS" };

export default function OspeMaterialPage() {
  return <MaterialLibraryPage libraryType="ospe_material" mode="full" />;
}
