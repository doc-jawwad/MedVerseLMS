import { MaterialLibraryPage } from "@/components/library/material-library-page";

export const metadata = { title: "Books — MedVerse LMS" };

export default function BooksPage() {
  return <MaterialLibraryPage libraryType="books" mode="full" />;
}
