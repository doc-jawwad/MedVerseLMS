/** Pure labels for Content Bin entity types (safe for client + unit tests). */

export type ContentBinEntityType =
  | "material_folder"
  | "material"
  | "pearl_point"
  | "ospe_station"
  | "question"
  | "prof_session_day"
  | "one_liner";

export function contentBinEntityLabel(type: ContentBinEntityType): string {
  switch (type) {
    case "material_folder":
      return "Folder";
    case "material":
      return "Material";
    case "pearl_point":
      return "Pearl Point";
    case "ospe_station":
      return "OSPE station";
    case "question":
      return "MCQ";
    case "prof_session_day":
      return "Prof. Session day";
    case "one_liner":
      return "One-liner";
    default:
      return type;
  }
}
